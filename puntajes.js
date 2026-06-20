/*
 * Página pública solo para ver puntajes de participantes.
 * No guarda datos ni modifica Cloudflare. Solo hace GET al Worker.
 */

const SCOREBOARD_CONFIG = window.APP_CONFIG || {};
const SCOREBOARD_API_ENDPOINT = SCOREBOARD_CONFIG.API_ENDPOINT || '';
const SCOREBOARD_POINTS_PER_PARTICIPANT = 100;

window.addEventListener('DOMContentLoaded', () => {
  const refreshButton = document.getElementById('refresh-scoreboard');
  if (refreshButton) {
    refreshButton.addEventListener('click', renderScoreboard);
  }

  renderScoreboard();
});

function toScoreNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatScorePoints(value) {
  const number = toScoreNumber(value, 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

function setScoreboardStatus(message, type = 'info') {
  const status = document.getElementById('scoreboard-status');
  if (!status) return;
  status.className = `sync-status ${type}`;
  status.textContent = message;
}

async function fetchScoreboardData() {
  if (!SCOREBOARD_API_ENDPOINT) {
    throw new Error('Falta configurar API_ENDPOINT en config.js.');
  }

  const response = await fetch(`${SCOREBOARD_API_ENDPOINT}?_=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Cloudflare respondió con estado ${response.status}.`);
  }

  return response.json();
}

function normalizeScoreboardData(data) {
  const source = data && typeof data === 'object' ? data : {};

  return {
    participants: Array.isArray(source.participants)
      ? source.participants
          .map((participant) => ({
            name: String(participant.name || '').trim(),
            correct: toScoreNumber(participant.correct, 0),
            points: toScoreNumber(participant.points, 0)
          }))
          .filter((participant) => participant.name)
      : [],
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {},
    accumulatedPool: toScoreNumber(source.accumulatedPool ?? source.accumulatedPot, 0),
    accumulatedPot: toScoreNumber(source.accumulatedPot ?? source.accumulatedPool, 0),
    settings: {
      pointsResetAfterResultIndex: null,
      pointsResetAt: null,
      manualPointsAfterResultIndex: null,
      manualPointsAt: null,
      manualPointsByParticipant: null,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
    }
  };
}

function getScoreboardPointsResetAfterResultIndex(data) {
  const value = data && data.settings ? data.settings.pointsResetAfterResultIndex : null;
  if (value !== null && value !== undefined && value !== '') {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }

  const resetKeys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && data.results[key] && data.results[key].pointsResetBoundary);

  return resetKeys.length ? Math.max(...resetKeys) : -1;
}

function getScoreboardLastClosedMatchIndex(data) {
  const keys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key));

  return keys.length ? Math.max(...keys) : -1;
}

function getScoreboardManualPointsAfterResultIndex(data) {
  const value = data && data.settings ? data.settings.manualPointsAfterResultIndex : null;
  if (value !== null && value !== undefined && value !== '') {
    const number = Number(value);
    if (Number.isInteger(number)) return number;
  }

  const manualKeys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && data.results[key] && data.results[key].manualPointsBoundary);

  return manualKeys.length ? Math.max(...manualKeys) : -1;
}

function hasScoreboardManualPointsBaseline(data) {
  return Boolean(
    data &&
    data.settings &&
    data.settings.manualPointsAt
  ) || Object.values((data && data.results) || {}).some((result) => result && result.manualPointsBoundary);
}

function getScoreboardManualPointsByParticipant(data) {
  const source = data && data.settings ? data.settings.manualPointsByParticipant : null;

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return new Map(
      Object.entries(source)
        .map(([name, points]) => [name, toScoreNumber(points, 0)])
    );
  }

  const manualIndex = getScoreboardManualPointsAfterResultIndex(data);
  const boundaryPoints = data &&
    data.results &&
    data.results[manualIndex] &&
    data.results[manualIndex].manualPointsByParticipant;

  if (boundaryPoints && typeof boundaryPoints === 'object' && !Array.isArray(boundaryPoints)) {
    return new Map(
      Object.entries(boundaryPoints)
        .map(([name, points]) => [name, toScoreNumber(points, 0)])
    );
  }

  return new Map(
    (Array.isArray(data && data.participants) ? data.participants : [])
      .map((participant) => [participant.name, toScoreNumber(participant.points, 0)])
  );
}

function hasScoreboardAwardedResult(data) {
  return Object.values((data && data.results) || {}).some((result) => (
    result &&
    Array.isArray(result.winners) &&
    result.winners.length > 0
  ));
}

function shouldInferScoreboardPointsReset(data) {
  const participants = Array.isArray(data && data.participants) ? data.participants : [];

  return (
    getScoreboardPointsResetAfterResultIndex(data) < 0 &&
    participants.length > 0 &&
    participants.every((participant) => toScoreNumber(participant.points, 0) === 0) &&
    getScoreboardLastClosedMatchIndex(data) >= 0 &&
    hasScoreboardAwardedResult(data)
  );
}

function inferMissingScoreboardPointsReset(data) {
  if (shouldInferScoreboardPointsReset(data)) {
    const resetIndex = getScoreboardLastClosedMatchIndex(data);
    const resetAt = data.settings.pointsResetAt || new Date().toISOString();

    data.settings = {
      ...(data.settings || {}),
      pointsResetAfterResultIndex: resetIndex,
      pointsResetAt: resetAt
    };

    data.results[resetIndex] = {
      ...(data.results[resetIndex] || {}),
      pointsResetBoundary: true,
      pointsResetAt: resetAt
    };
  }

  return data;
}

function recalculateScoreboardStandings(data) {
  inferMissingScoreboardPointsReset(data);

  const manualPointsByParticipant = getScoreboardManualPointsByParticipant(data);
  const pointsResetAfterResultIndex = getScoreboardPointsResetAfterResultIndex(data);
  const manualPointsAfterResultIndex = getScoreboardManualPointsAfterResultIndex(data);
  const useManualPointsBaseline = (
    hasScoreboardManualPointsBaseline(data) &&
    manualPointsAfterResultIndex >= pointsResetAfterResultIndex
  );
  const shouldRecalculatePoints = pointsResetAfterResultIndex >= 0 || useManualPointsBaseline;
  const pointsStartAfterResultIndex = useManualPointsBaseline
    ? manualPointsAfterResultIndex
    : pointsResetAfterResultIndex;

  data.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = (useManualPointsBaseline || !shouldRecalculatePoints)
      ? (manualPointsByParticipant.get(participant.name) || 0)
      : 0;
  });

  let runningAccumulated = 0;

  const resultKeys = Object.keys(data.results || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key))
    .sort((a, b) => a - b);

  resultKeys.forEach((idx) => {
    const result = data.results[idx];
    if (!result) return;

    const basePool = toScoreNumber(result.basePool, data.participants.length * SCOREBOARD_POINTS_PER_PARTICIPANT);
    const totalPool = runningAccumulated + basePool;
    const winners = [];

    data.participants.forEach((participant) => {
      const prediction = data.predictions[idx] ? data.predictions[idx][participant.name] : null;
      if (
        prediction &&
        Number(prediction.score1) === Number(result.score1) &&
        Number(prediction.score2) === Number(result.score2)
      ) {
        participant.correct += 1;
        winners.push(participant.name);
      }
    });

    if (winners.length > 0) {
      const pointsPerWinner = totalPool / winners.length;
      data.participants.forEach((participant) => {
        if (shouldRecalculatePoints && idx > pointsStartAfterResultIndex && winners.includes(participant.name)) {
          participant.points += pointsPerWinner;
        }
      });
      runningAccumulated = 0;
    } else {
      runningAccumulated = totalPool;
    }
  });

  data.accumulatedPool = runningAccumulated;
  data.accumulatedPot = runningAccumulated;
  return data;
}

function getSortedParticipants(participants) {
  return participants.slice().sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return a.name.localeCompare(b.name, 'es');
  });
}

function updateSummaryCards(data) {
  const totalParticipants = document.getElementById('total-participants');
  const currentPool = document.getElementById('current-pool');
  const finishedMatches = document.getElementById('finished-matches');
  const lastUpdate = document.getElementById('last-update');

  if (totalParticipants) totalParticipants.textContent = data.participants.length;
  if (currentPool) currentPool.textContent = formatScorePoints(data.accumulatedPool || 0);
  if (finishedMatches) finishedMatches.textContent = Object.keys(data.results || {}).length;
  if (lastUpdate) {
    lastUpdate.textContent = new Date().toLocaleTimeString('es-CR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

function renderScoreboardTable(participants) {
  const container = document.getElementById('scoreboard-table-container');
  if (!container) return;

  container.innerHTML = '';

  if (!participants || participants.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'Todavía no hay participantes registrados.';
    container.appendChild(emptyMessage);
    return;
  }

  const table = document.createElement('table');
  table.className = 'scoreboard-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  ['Posición', 'Participante', 'Aciertos', 'Puntos ganados'].forEach((title) => {
    const th = document.createElement('th');
    th.textContent = title;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  getSortedParticipants(participants).forEach((participant, index) => {
    const row = document.createElement('tr');
    if (index === 0 && participant.points > 0) row.classList.add('leader-row');

    const positionCell = document.createElement('td');
    positionCell.className = 'position-cell';
    positionCell.textContent = `${index + 1}`;

    const nameCell = document.createElement('td');
    nameCell.className = 'participant-name-cell';
    nameCell.textContent = participant.name;

    const correctCell = document.createElement('td');
    correctCell.textContent = formatScorePoints(participant.correct || 0);

    const pointsCell = document.createElement('td');
    pointsCell.className = 'points-cell';
    pointsCell.textContent = formatScorePoints(participant.points || 0);

    row.appendChild(positionCell);
    row.appendChild(nameCell);
    row.appendChild(correctCell);
    row.appendChild(pointsCell);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

async function renderScoreboard() {
  const refreshButton = document.getElementById('refresh-scoreboard');

  try {
    if (refreshButton) refreshButton.disabled = true;
    setScoreboardStatus('Cargando puntajes desde Cloudflare...', 'info');

    const rawData = await fetchScoreboardData();
    const data = recalculateScoreboardStandings(normalizeScoreboardData(rawData));

    updateSummaryCards(data);
    renderScoreboardTable(data.participants);
    setScoreboardStatus('Puntajes cargados correctamente desde Cloudflare.', 'success');
  } catch (error) {
    console.error('No se pudieron cargar los puntajes:', error);
    setScoreboardStatus(`No se pudieron cargar los puntajes. ${error.message}`, 'error');
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}
