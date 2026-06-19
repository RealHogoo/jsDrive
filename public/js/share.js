(function () {
  "use strict";

  var token = (document.body && document.body.getAttribute("data-webhard-share-token")) || "";
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
    detail.replaceChildren();
    if (password.value) {
      detail.appendChild(passwordForm());
      return;
    }
    detail.appendChild(downloadLinkRow());
  }

  function passwordForm() {
    var row = document.createElement("form");
    var title = document.createElement("strong");
    var hint = document.createElement("span");
    var hidden = document.createElement("input");
    var action = document.createElement("em");
    var button = document.createElement("button");

    row.className = "stat-row";
    row.method = "post";
    row.action = "/share/download/" + encodeURIComponent(token);
    title.textContent = "다운로드";
    hint.textContent = "비밀번호가 서버로 안전하게 전송됩니다.";
    hidden.type = "hidden";
    hidden.name = "password";
    hidden.value = password.value;
    button.className = "btn primary";
    button.type = "submit";
    button.textContent = "받기";

    action.appendChild(button);
    row.appendChild(title);
    row.appendChild(hint);
    row.appendChild(hidden);
    row.appendChild(action);
    return row;
  }

  function downloadLinkRow() {
    var row = document.createElement("div");
    var title = document.createElement("strong");
    var hint = document.createElement("span");
    var action = document.createElement("em");
    var link = document.createElement("a");

    row.className = "stat-row";
    title.textContent = "다운로드";
    hint.textContent = "비밀번호가 없는 링크입니다.";
    link.className = "btn primary";
    link.href = "/share/download/" + encodeURIComponent(token);
    link.textContent = "받기";

    action.appendChild(link);
    row.appendChild(title);
    row.appendChild(hint);
    row.appendChild(action);
    return row;
  }
})();
