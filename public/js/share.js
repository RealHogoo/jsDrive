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
    var downloadUrl = "/share/download/" + encodeURIComponent(token);
    if (password.value) {
      downloadUrl += "?password=" + encodeURIComponent(password.value);
    }
    message.textContent = "공유 링크가 열렸습니다.";
    detail.innerHTML = "<div class=\"stat-row\">"
      + "<strong>다운로드</strong>"
      + "<span>비밀번호가 있는 링크는 입력 후 다시 확인하세요.</span>"
      + "<em><a class=\"btn primary\" href=\"" + escapeAttr(downloadUrl) + "\">받기</a></em>"
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
