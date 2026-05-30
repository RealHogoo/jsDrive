(function () {
  "use strict";

  var token = window.WEBHARD_SHARE_TOKEN || "";
  var form = document.getElementById("shareAccessForm");
  var password = document.getElementById("sharePassword");
  var message = document.getElementById("shareMessage");
  var detail = document.getElementById("shareDetail");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    render();
  });

  render();

  function render() {
    message.textContent = "공유 링크가 열렸습니다.";
    if (password.value) {
      detail.innerHTML = "<form class=\"stat-row\" method=\"post\" action=\"/share/download/" + escapeAttr(token) + "\">"
        + "<strong>다운로드</strong>"
        + "<span>비밀번호가 서버로 안전하게 전송됩니다.</span>"
        + "<input type=\"hidden\" name=\"password\" value=\"" + escapeAttr(password.value) + "\">"
        + "<em><button class=\"btn primary\" type=\"submit\">받기</button></em>"
        + "</form>";
      return;
    }
    detail.innerHTML = "<div class=\"stat-row\">"
      + "<strong>다운로드</strong>"
      + "<span>비밀번호가 없는 링크입니다.</span>"
      + "<em><a class=\"btn primary\" href=\"/share/download/" + escapeAttr(token) + "\">받기</a></em>"
      + "</div>";
  }

  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
