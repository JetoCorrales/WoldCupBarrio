/*
 * Página pública de resultados.
 * Solo lectura: no usa POST, no guarda en localStorage y no modifica Cloudflare.
 * Consulta datos con GET desde Cloudflare Worker y archivos estáticos de partidos.
 */

const RESULTS_CONFIG = window.APP_CONFIG || {};
const API_ENDPOINT_RESULTS = RESULTS_CONFIG.API_ENDPOINT || '';
const POINTS_PER_PARTICIPANT_RESULTS = 100;

window.addEventListener('DOMContentLoaded', () => {
  const refreshButton = document.getElementById('refresh-results');
  if (refreshButton) {
    refreshButton.addEventListener('click', renderPublicResults);
  }

  renderPublicResults();
});

function toNumberResults(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPointsResults(value) {
  const number = toNumberResults(value, 0);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
}

function setResultsStatus(message, type = 'info') {
  const status = document.getElementById('results-status');
  if (!status) return;
  status.className = `sync-status ${type}`;
  status.textContent = message;
}

async function loadBetDataReadOnly() {
  if (!API_ENDPOINT_RESULTS) {
    throw new Error('Falta configurar API_ENDPOINT en config.js.');
  }

  const response = await fetch(`${API_ENDPOINT_RESULTS}?_=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Cloudflare respondió con estado ${response.status}.`);
  }

  return response.json();
}

async function loadMatchesDataReadOnly() {
  try {
    const response = await fetch('matches.json', {
      method: 'GET',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`matches.json respondió ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.warn('No se pudo cargar matches.json. Se usará MATCHES_DATA:', error);
    return { matches: Array.isArray(window.MATCHES_DATA) ? window.MATCHES_DATA : [] };
  }
}

function sortMatchesChronologically(matches) {
  return (Array.isArray(matches) ? matches.slice() : []).sort((a, b) => {
    const timeA = a && a.time ? String(a.time).split(' ')[0] : '00:00';
    const timeB = b && b.time ? String(b.time).split(' ')[0] : '00:00';
    const dateA = new Date(`${a && a.date ? a.date : '9999-12-31'}T${timeA}`);
    const dateB = new Date(`${b && b.date ? b.date : '9999-12-31'}T${timeB}`);
    return dateA - dateB;
  });
}

function normalizeBetDataResults(data) {
  const source = data && typeof data === 'object' ? data : {};

  return {
    participants: Array.isArray(source.participants)
      ? source.participants
          .map((p) => ({
            name: String(p.name || '').trim(),
            correct: toNumberResults(p.correct, 0),
            points: toNumberResults(p.points, 0)
          }))
          .filter((p) => p.name)
      : [],
    predictions: source.predictions && typeof source.predictions === 'object' ? source.predictions : {},
    results: source.results && typeof source.results === 'object' ? source.results : {},
    accumulatedPool: toNumberResults(source.accumulatedPool ?? source.accumulatedPot, 0),
    accumulatedPot: toNumberResults(source.accumulatedPot ?? source.accumulatedPool, 0),
    settings: {
      pointsResetAfterResultIndex: null,
      pointsResetAt: null,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
    }
  };
}

function getPointsResetAfterResultIndexResults(data) {
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

function getLastClosedMatchIndexResults(data) {
  const keys = Object.keys((data && data.results) || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key));

  return keys.length ? Math.max(...keys) : -1;
}

function hasAwardedResultResults(data) {
  return Object.values((data && data.results) || {}).some((result) => (
    result &&
    Array.isArray(result.winners) &&
    result.winners.length > 0
  ));
}

function shouldInferPointsResetResults(data) {
  const participants = Array.isArray(data && data.participants) ? data.participants : [];

  return (
    getPointsResetAfterResultIndexResults(data) < 0 &&
    participants.length > 0 &&
    participants.every((participant) => toNumberResults(participant.points, 0) === 0) &&
    getLastClosedMatchIndexResults(data) >= 0 &&
    hasAwardedResultResults(data)
  );
}

function inferMissingPointsResetSettingsResults(data) {
  if (shouldInferPointsResetResults(data)) {
    const resetIndex = getLastClosedMatchIndexResults(data);
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

function recalculateStandingsResults(data) {
  inferMissingPointsResetSettingsResults(data);

  data.participants.forEach((participant) => {
    participant.correct = 0;
    participant.points = 0;
  });

  let runningAccumulated = 0;
  const pointsResetAfterResultIndex = getPointsResetAfterResultIndexResults(data);

  const resultKeys = Object.keys(data.results || {})
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key))
    .sort((a, b) => a - b);

  resultKeys.forEach((idx) => {
    const result = data.results[idx];
    if (!result) return;

    const basePool = toNumberResults(
      result.basePool,
      data.participants.length * POINTS_PER_PARTICIPANT_RESULTS
    );
    const previousAccumulated = runningAccumulated;
    const totalPool = previousAccumulated + basePool;
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

    let pointsPerWinner = 0;
    if (winners.length > 0) {
      pointsPerWinner = totalPool / winners.length;
      data.participants.forEach((participant) => {
        if (idx > pointsResetAfterResultIndex && winners.includes(participant.name)) {
          participant.points += pointsPerWinner;
        }
      });
      runningAccumulated = 0;
    } else {
      runningAccumulated = totalPool;
    }

    result.participantCount = toNumberResults(result.participantCount, data.participants.length);
    result.pointsPerParticipant = POINTS_PER_PARTICIPANT_RESULTS;
    result.basePool = basePool;
    result.previousAccumulated = previousAccumulated;
    result.totalPool = totalPool;
    result.winners = winners;
    result.pointsPerWinner = pointsPerWinner;
    result.accumulatedAfter = runningAccumulated;
  });

  data.accumulatedPool = runningAccumulated;
  data.accumulatedPot = runningAccumulated;

  return data;
}

function updateResultsCards(data) {
  const totalParticipants = document.getElementById('results-total-participants');
  const currentPool = document.getElementById('results-current-pool');
  const finishedMatches = document.getElementById('results-finished-matches');
  const lastUpdate = document.getElementById('results-last-update');

  if (totalParticipants) totalParticipants.textContent = data.participants.length;
  if (currentPool) currentPool.textContent = formatPointsResults(data.accumulatedPool || 0);
  if (finishedMatches) finishedMatches.textContent = Object.keys(data.results || {}).length;
  if (lastUpdate) {
    lastUpdate.textContent = new Date().toLocaleTimeString('es-CR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

function renderParticipantsSummary(participants, data) {
  const container = document.getElementById('participants-summary');
  if (!container) return;
  container.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'pool-summary';
  summary.innerHTML = `
    <strong>Regla:</strong> ${POINTS_PER_PARTICIPANT_RESULTS} puntos virtuales por participante en cada partido.<br>
    <strong>Acumulado actual:</strong> ${formatPointsResults(data.accumulatedPool || 0)} puntos.
  `;
  container.appendChild(summary);

  if (!participants || participants.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No hay participantes registrados.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'scoreboard-table';
  const thead = document.createElement('thead');
  const hdrRow = document.createElement('tr');

  ['Posición', 'Participante', 'Aciertos', 'Puntos ganados'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    hdrRow.appendChild(th);
  });

  thead.appendChild(hdrRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  participants
    .slice()
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.name.localeCompare(b.name, 'es');
    })
    .forEach((p, index) => {
      const tr = document.createElement('tr');

      const tdPosition = document.createElement('td');
      tdPosition.className = 'position-cell';
      tdPosition.textContent = String(index + 1);

      const tdName = document.createElement('td');
      tdName.className = 'participant-name-cell';
      tdName.textContent = p.name;

      const tdCorrect = document.createElement('td');
      tdCorrect.textContent = formatPointsResults(p.correct);

      const tdPoints = document.createElement('td');
      tdPoints.className = 'points-cell';
      tdPoints.textContent = formatPointsResults(p.points);

      tr.appendChild(tdPosition);
      tr.appendChild(tdName);
      tr.appendChild(tdCorrect);
      tr.appendChild(tdPoints);
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  container.appendChild(table);
}

function renderMatchesSummary(results, matches) {
  const container = document.getElementById('matches-summary');
  if (!container) return;
  container.innerHTML = '';

  const resArray = Object.keys(results || {}).map((idx) => ({
    idx: parseInt(idx, 10),
    result: results[idx]
  }));

  if (resArray.length === 0) {
    container.textContent = 'Aún no hay resultados registrados.';
    return;
  }

  resArray.sort((a, b) => a.idx - b.idx);

  resArray.forEach(({ idx, result }) => {
    const match = matches[idx];
    const card = document.createElement('div');
    card.className = 'match-result-card';

    const title = document.createElement('h3');
    title.textContent = match ? `${match.team1} vs. ${match.team2}` : `Partido ${idx + 1}`;

    const info = document.createElement('p');
    if (match) info.textContent = `${match.date}${match.time ? ' ' + match.time : ''}`;

    const score = document.createElement('p');
    score.textContent = `Marcador final: ${result.score1} - ${result.score2}`;

    const baseInfo = document.createElement('p');
    baseInfo.textContent = `Bolsa base: ${formatPointsResults(result.basePool || 0)} puntos.`;

    const previousInfo = document.createElement('p');
    previousInfo.textContent = `Acumulado anterior: ${formatPointsResults(result.previousAccumulated || 0)} puntos.`;

    const totalInfo = document.createElement('p');
    totalInfo.textContent = `Bolsa total: ${formatPointsResults(result.totalPool || 0)} puntos.`;

    const winnersInfo = document.createElement('p');
    if (result.winners && result.winners.length > 0) {
      winnersInfo.textContent = `Acertaron (${result.winners.length}): ${result.winners.join(', ')}. Cada uno gana ${formatPointsResults(result.pointsPerWinner)} puntos.`;
    } else {
      winnersInfo.textContent = `Nadie acertó. Se acumulan ${formatPointsResults(result.accumulatedAfter || 0)} puntos.`;
    }

    card.appendChild(title);
    if (info.textContent) card.appendChild(info);
    card.appendChild(score);
    card.appendChild(baseInfo);
    card.appendChild(previousInfo);
    card.appendChild(totalInfo);
    card.appendChild(winnersInfo);
    container.appendChild(card);
  });
}

async function renderPublicResults() {
  const refreshButton = document.getElementById('refresh-results');

  try {
    if (refreshButton) refreshButton.disabled = true;
    setResultsStatus('Cargando datos desde Cloudflare...', 'info');

    const [rawData, matchesData] = await Promise.all([
      loadBetDataReadOnly(),
      loadMatchesDataReadOnly()
    ]);

    const normalized = recalculateStandingsResults(normalizeBetDataResults(rawData));
    const rawMatches = Array.isArray(matchesData.matches) ? matchesData.matches : matchesData;
    const matches = sortMatchesChronologically(rawMatches);

    updateResultsCards(normalized);
    renderParticipantsSummary(normalized.participants || [], normalized);
    renderMatchesSummary(normalized.results || {}, matches || []);
    setResultsStatus('Datos cargados correctamente desde Cloudflare. Modo solo consulta.', 'success');
  } catch (error) {
    console.error('Error al cargar datos:', error);
    updateResultsCards({ participants: [], results: {}, accumulatedPool: 0 });
    renderParticipantsSummary([], { accumulatedPool: 0 });
    const matchesContainer = document.getElementById('matches-summary');
    if (matchesContainer) matchesContainer.textContent = 'No se pudieron cargar los resultados.';
    setResultsStatus(`No se pudieron cargar los datos. ${error.message}`, 'error');
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}
