(function () {
  "use strict";

  var titles = {
    "401": "로그인이 필요합니다",
    "403": "권한이 없습니다",
    "S4003": "웹하드 서비스가 비활성화되었습니다",
    "404": "파일 또는 화면을 찾을 수 없습니다",
    "500": "요청을 처리할 수 없습니다"
  };
  var messages = {
    "401": "웹하드에 다시 로그인한 뒤 이용하세요.",
    "403": "관리자에게 웹하드 접근 권한 설정을 요청하세요.",
    "S4003": "관리자가 서비스를 다시 사용 처리할 때까지 화면을 열 수 없습니다.",
    "404": "요청한 파일이나 화면이 없거나 삭제되었습니다.",
    "500": "잠시 후 다시 시도하거나 관리자에게 문의하세요."
  };
  var params = new URLSearchParams(window.location.search || "");
  var body = document.body;
  var code = params.get("code") || body.getAttribute("data-error-code") || "ERROR";
  var message = params.get("message") || body.getAttribute("data-error-message") || messages[code] || messages["500"];
  var backButton = document.getElementById("backButton");

  document.getElementById("errorCode").textContent = code;
  document.getElementById("errorTitle").textContent = titles[code] || titles["500"];
  document.getElementById("errorMessage").textContent = message;

  if (backButton) {
    backButton.addEventListener("click", function () {
      history.back();
    });
  }
})();
