// This plain script stays independent of React's hashed chunks.
// If hydration fails, replace the pending screen with a visible recovery action.
(function () {
  window.setTimeout(function () {
    var pending = document.querySelector('[data-naryad-loading="true"]');
    if (!pending) return;
    pending.replaceChildren();
    var title = document.createElement('h1');
    title.textContent = 'НарядAI';
    var message = document.createElement('p');
    message.textContent = 'Не удалось загрузить интерфейс. Проверьте Wi-Fi и запущенный сервер на ноутбуке.';
    var retry = document.createElement('button');
    retry.className = 'primary wide';
    retry.textContent = 'Обновить приложение';
    retry.addEventListener('click', function () {
      window.location.reload();
    });
    pending.append(title, message, retry);
  }, 15000);
})();
