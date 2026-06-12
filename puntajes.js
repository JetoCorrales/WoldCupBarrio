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
    settings: source.settings && typeof source.settings === 'object' ? source.settings : {}
  };
}

function recalculateScoreboardStandings(data) {
  data.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = 0;
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
        if (winners.includes(participant.name)) {
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
