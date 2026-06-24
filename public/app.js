(function () {
  'use strict';

  var form = document.getElementById('shorten-form');
  var urlInput = document.getElementById('url');
  var aliasInput = document.getElementById('alias');
  var submitBtn = document.getElementById('submit');
  var errorBox = document.getElementById('error');
  var resultBox = document.getElementById('result');
  var resultLink = document.getElementById('result-link');
  var copyBtn = document.getElementById('copy');
  var historyList = document.getElementById('history-list');
  var historyEmpty = document.getElementById('history-empty');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    resultBox.hidden = true;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function showResult(shortUrl) {
    resultLink.textContent = shortUrl;
    resultLink.href = shortUrl;
    resultBox.hidden = false;
  }

  async function postShorten(url, alias) {
    var payload = { url: url };
    if (alias) payload.alias = alias;
    var res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var msg = data && data.error && data.error.message
        ? data.error.message
        : 'Request failed (' + res.status + ')';
      throw new Error(msg);
    }
    return data;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearError();
    var url = urlInput.value.trim();
    var alias = aliasInput.value.trim();
    if (!url) {
      showError('Please enter a URL.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Shortening…';
    try {
      var data = await postShorten(url, alias);
      showResult(data.shortUrl);
      urlInput.value = '';
      aliasInput.value = '';
      await loadHistory();
    } catch (err) {
      showError(err && err.message ? err.message : 'Something went wrong.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Shorten';
    }
  });

  copyBtn.addEventListener('click', async function () {
    var text = resultLink.textContent;
    try {
      await navigator.clipboard.writeText(text);
      var original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(function () {
        copyBtn.textContent = original;
        copyBtn.classList.remove('copied');
      }, 1500);
    } catch (err) {
      showError('Could not copy to clipboard.');
    }
  });

  // Build history rows with the DOM API + textContent only — user-supplied
  // target URLs are never injected as HTML (no DOM XSS).
  function buildHistoryItem(item) {
    var li = document.createElement('li');
    li.className = 'history-item';

    var main = document.createElement('div');
    main.className = 'history-main';

    var link = document.createElement('a');
    link.className = 'history-short';
    link.href = item.shortUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.shortUrl;

    var target = document.createElement('span');
    target.className = 'history-target';
    target.textContent = item.target;
    target.title = item.target;

    main.appendChild(link);
    main.appendChild(target);

    var clicks = document.createElement('span');
    clicks.className = 'history-clicks';
    var n = Number(item.clickCount) || 0;
    clicks.textContent = n + (n === 1 ? ' click' : ' clicks');

    li.appendChild(main);
    li.appendChild(clicks);
    return li;
  }

  async function loadHistory() {
    try {
      var res = await fetch('/api/urls');
      if (!res.ok) return;
      var data = await res.json();
      var urls = (data && data.urls) || [];
      historyList.textContent = '';
      if (urls.length === 0) {
        historyEmpty.hidden = false;
        return;
      }
      historyEmpty.hidden = true;
      urls.forEach(function (item) {
        historyList.appendChild(buildHistoryItem(item));
      });
    } catch (err) {
      /* history is non-critical; ignore fetch failures */
    }
  }

  loadHistory();
})();
