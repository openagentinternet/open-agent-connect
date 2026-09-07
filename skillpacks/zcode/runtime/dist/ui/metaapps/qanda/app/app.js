/**
 * On-chain Q&A viewer (bundled MetaApp; OAC port of the IDBots feat/metaweb-qa
 * qanda app).
 *
 * Data comes straight from the public MetaSo Q&A APIs (so.metaid.io,
 * no auth, permissive CORS) — same posture as the bundled buzz app, which
 * also fetches its APIs directly from inside the Bot Browser iframe:
 *   - GET /api/qa/questions              latest / unanswered feed
 *   - GET /api/qa/questions/:pinId       question detail + ranked answers
 *   - GET /api/qa/questions/:pinId/answers  answers pagination (cursor)
 *   - GET /api/metaweb/pin/:pinId        full body text of a pin
 * Read-only viewer by design: reacting (like/dislike) stays with the bots.
 *
 * OAC adaptations: the API base honors the daemon-injected infrastructure
 * endpoint (window.__OAC_INFRASTRUCTURE__.metasoP2PBaseUrl) with the public
 * node as fallback, and a question can be opened either through the hash
 * router (#/q/<pinId>) or the localUiUrl query form (?q=<pinId>).
 */
(function () {
  'use strict';

  var infrastructure = window.__OAC_INFRASTRUCTURE__ || {};
  var API_BASE = (infrastructure.metasoP2PBaseUrl || 'https://so.metaid.io').replace(/\/+$/, '');
  var FEED_SIZE = 20;

  var main = document.getElementById('main');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeText(unixSeconds) {
    if (!unixSeconds) return '';
    try {
      return new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    } catch (error) {
      return '';
    }
  }

  function publisherName(publisher) {
    if (!publisher) return 'unknown';
    return publisher.name || publisher.globalMetaId || publisher.metaId || 'unknown';
  }

  function numberText(value) {
    var num = Number(value);
    return Number.isFinite(num) ? String(num) : '0';
  }

  async function apiGet(path) {
    var response = await fetch(API_BASE + path, { headers: { accept: 'application/json' } });
    var body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!body || typeof body !== 'object') {
      throw new Error('Q&A API returned an invalid response (HTTP ' + response.status + ').');
    }
    if (Number(body.code) === 0) return body.data || {};
    throw new Error('Q&A API error ' + body.code + ': ' + (body.message || 'unknown error'));
  }

  function setState(text) {
    main.innerHTML = '<div class="state">' + escapeHtml(text) + '</div>';
  }

  function setError(message) {
    main.innerHTML = '<div class="error-box">' + escapeHtml(message) + '</div>';
  }

  function tagsHtml(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.map(function (tag) {
      return '<span class="tag">' + escapeHtml(tag) + '</span>';
    }).join(' ');
  }

  function countsHtml(item) {
    var parts = [
      '<span class="count-pill' + (Number(item.answerCount) > 0 ? '' : ' zero') + '">' + numberText(item.answerCount) + ' answer' + (Number(item.answerCount) === 1 ? '' : 's') + '</span>',
      '<span>▲ ' + numberText(item.likeCount) + '</span>',
    ];
    if (Number(item.dislikeCount) > 0) parts.push('<span>▼ ' + numberText(item.dislikeCount) + '</span>');
    if (Number(item.commentCount) > 0) parts.push('<span>' + numberText(item.commentCount) + ' comments</span>');
    return parts.join('<span class="sep"></span>');
  }

  function metaRow(item, extra) {
    var parts = ['<span>' + escapeHtml(publisherName(item.publisher)) + '</span>'];
    if (item.createdAt) parts.push('<span>' + escapeHtml(timeText(item.createdAt)) + '</span>');
    if (extra) parts.push(extra);
    if (item.isMempool) parts.push('<span class="mempool-pill">mempool · unconfirmed</span>');
    return '<div class="meta-row">' + parts.join('<span class="sep"></span>') + '</div>';
  }

  function questionCard(question) {
    var html = '<article class="card">';
    html += '<h2 class="q-title"><a href="#/q/' + escapeHtml(question.pinId) + '">' + escapeHtml(question.title || '(untitled question)') + '</a></h2>';
    if (question.summary) {
      html += '<div class="answer-summary">' + escapeHtml(question.summary) + '</div>';
    }
    html += metaRow(question, countsHtml(question));
    var tags = tagsHtml(question.tags);
    if (tags) html += '<div class="meta-row">' + tags + '</div>';
    if (question.topAnswer && question.topAnswer.pinId) {
      var top = question.topAnswer;
      html += '<div class="top-answer"><span class="ta-label">TOP ANSWER +' + numberText(top.likeCount) + (Number(top.dislikeCount) > 0 ? '/-' + numberText(top.dislikeCount) : '') + '</span>'
        + escapeHtml(top.summary || '(no summary)') + '</div>';
    }
    html += '</article>';
    return html;
  }

  function renderFeed(mode, cursor) {
    var query = '?size=' + FEED_SIZE + (mode === 'unanswered' ? '&maxAnswers=0' : '');
    if (cursor) query += '&cursor=' + encodeURIComponent(cursor);
    return apiGet('/api/qa/questions' + query).then(function (data) {
      var items = Array.isArray(data.items) ? data.items : [];
      if (!cursor && !items.length) {
        setState(mode === 'unanswered'
          ? 'No unanswered questions right now — the queue is clear.'
          : 'No questions on-chain yet.');
        return;
      }
      var html = items.map(questionCard).join('');
      if (data.hasMore && data.nextCursor) {
        html += '<button class="load-more" id="load-more">Load more</button>';
      }
      if (cursor) {
        main.insertAdjacentHTML('beforeend', html);
      } else {
        main.innerHTML = html;
      }
      var more = document.getElementById('load-more');
      if (more) {
        more.addEventListener('click', function () {
          more.remove();
          renderFeed(mode, data.nextCursor).catch(function (error) { setError(error.message); });
        });
      }
    });
  }

  function fullAnswerDetails(answer) {
    var details = document.createElement('details');
    details.className = 'full-answer';
    var summary = document.createElement('summary');
    summary.textContent = 'Read full answer';
    details.appendChild(summary);
    var body = document.createElement('div');
    body.className = 'full-body';
    body.textContent = 'Loading…';
    details.appendChild(body);
    var loaded = false;
    details.addEventListener('toggle', function () {
      if (!details.open || loaded) return;
      loaded = true;
      apiGet('/api/metaweb/pin/' + encodeURIComponent(answer.pinId)).then(function (data) {
        body.textContent = (data && typeof data.text === 'string' && data.text.trim())
          ? data.text
          : '(No readable body — open the pin directly.)';
      }).catch(function (error) {
        body.textContent = 'Failed to load the full answer: ' + error.message;
      });
    });
    return details;
  }

  function answerCard(answer, rank) {
    var article = document.createElement('article');
    article.className = 'card';
    var head = '<div class="answer-head"><span class="answer-rank">#' + rank + '</span>'
      + '<span class="score">score ' + numberText(answer.score) + ' · ▲ ' + numberText(answer.likeCount)
      + (Number(answer.dislikeCount) > 0 ? ' · ▼ ' + numberText(answer.dislikeCount) : '')
      + (Number(answer.commentCount) > 0 ? ' · ' + numberText(answer.commentCount) + ' comments' : '')
      + '</span></div>';
    article.insertAdjacentHTML('beforeend',
      head
      + '<div class="answer-summary">' + escapeHtml(answer.summary || '(no summary)') + '</div>'
      + metaRow(answer)
      + (Array.isArray(answer.tags) && answer.tags.length ? '<div class="meta-row">' + tagsHtml(answer.tags) + '</div>' : '')
    );
    article.appendChild(fullAnswerDetails(answer));
    return article;
  }

  function renderQuestion(pinId) {
    return apiGet('/api/qa/questions/' + encodeURIComponent(pinId)).then(function (data) {
      var question = data.question || {};
      var answers = Array.isArray(data.answers) ? data.answers : [];
      var questionHead = document.createElement('article');
      questionHead.className = 'card';
      var headHtml = '<h2 class="q-title">' + escapeHtml(question.title || '(untitled question)') + '</h2>';
      questionHead.insertAdjacentHTML('beforeend', headHtml + metaRow(question, countsHtml(question)));
      var tags = tagsHtml(question.tags);
      if (tags) questionHead.insertAdjacentHTML('beforeend', '<div class="meta-row">' + tags + '</div>');
      main.innerHTML = '';
      main.appendChild(questionHead);

      // Full question body (the QA surfaces carry summaries only).
      var bodyBox = document.createElement('div');
      bodyBox.className = 'question-body';
      bodyBox.textContent = 'Loading question…';
      main.appendChild(bodyBox);
      apiGet('/api/metaweb/pin/' + encodeURIComponent(question.pinId || pinId)).then(function (pinData) {
        bodyBox.textContent = (pinData && typeof pinData.text === 'string' && pinData.text.trim())
          ? pinData.text
          : '(No description — the question is its title.)';
      }).catch(function () {
        bodyBox.textContent = '(Full question body is unavailable right now.)';
      });

      var heading = document.createElement('h3');
      heading.textContent = answers.length ? 'Answers (ranked by likes − dislikes)' : 'No answers yet';
      main.appendChild(heading);
      var list = document.createElement('div');
      main.appendChild(list);
      answers.forEach(function (answer, index) {
        list.appendChild(answerCard(answer, index + 1));
      });
      if (data.hasMore && data.nextCursor) {
        appendAnswersPagination(question.pinId || pinId, data.nextCursor, list);
      }
    });
  }

  function appendAnswersPagination(pinId, cursor, list) {
    var button = document.createElement('button');
    button.className = 'load-more';
    button.textContent = 'Load more answers';
    main.appendChild(button);
    button.addEventListener('click', function () {
      button.remove();
      apiGet('/api/qa/questions/' + encodeURIComponent(pinId) + '/answers?cursor=' + encodeURIComponent(cursor))
        .then(function (data) {
          var items = Array.isArray(data.items) ? data.items : [];
          items.forEach(function (answer, index) {
            list.appendChild(answerCard(answer, list.children.length + 1));
          });
          if (data.hasMore && data.nextCursor) {
            appendAnswersPagination(pinId, data.nextCursor, list);
          }
        })
        .catch(function (error) { setError(error.message); });
    });
  }

  function setActiveTab(mode) {
    var links = document.querySelectorAll('#tabs a');
    links.forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('data-tab') === mode);
    });
  }

  function route() {
    // localUiUrl form (?q=<pinId>): redirect once into the hash router so
    // tabs and back/forward stay consistent.
    var queryPin = new URLSearchParams(window.location.search).get('q');
    if (queryPin && queryPin.trim()) {
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState(null, '', clean);
      location.hash = '#/q/' + encodeURIComponent(queryPin.trim());
      return;
    }
    var hash = (location.hash || '#/').replace(/^#\/?/, '');
    window.scrollTo(0, 0);
    if (hash.indexOf('q/') === 0) {
      setActiveTab(null);
      var pinId = decodeURIComponent(hash.slice(2).replace(/\/+$/, '')).trim();
      if (!pinId) { setState('No question pinId in the URL.'); return; }
      setState('Loading question…');
      renderQuestion(pinId).catch(function (error) {
        setError('Could not open this question: ' + error.message);
      });
      return;
    }
    var mode = hash === 'unanswered' ? 'unanswered' : 'latest';
    setActiveTab(mode);
    setState('Loading questions…');
    renderFeed(mode, null).catch(function (error) {
      setError('Could not load the question feed: ' + error.message);
    });
  }

  window.addEventListener('hashchange', route);
  route();
})();
