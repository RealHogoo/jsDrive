(function (global) {
  "use strict";

  var TOKEN_KEY = "webhard.accessToken";

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function saveToken(value) {
    localStorage.setItem(TOKEN_KEY, value || "");
  }

  function bindTokenBox() {
    var input = document.getElementById("token");
    var button = document.getElementById("saveToken");
    if (!input || !button) {
      return;
    }
    input.value = token();
    button.addEventListener("click", function () {
      saveToken(input.value.trim());
      button.textContent = "저장됨";
      setTimeout(function () {
        button.textContent = "저장";
      }, 1200);
    });
  }

  function authHeaders() {
    var value = token();
    return value ? { Authorization: "Bearer " + value } : {};
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("ko-KR", { hour12: false });
  }

  function localDateTimeValue(date) {
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
      + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  global.Webhard = {
    bindTokenBox: bindTokenBox,
    authHeaders: authHeaders,
    formatDateTime: formatDateTime,
    localDateTimeValue: localDateTimeValue
  };
})(window);
