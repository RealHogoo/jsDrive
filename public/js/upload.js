(function () {
  "use strict";

  Webhard.bindTokenBox();

  var form = document.getElementById("uploadForm");
  var fileInput = document.getElementById("file");
  var dateInput = document.getElementById("originalCreatedAt");
  var folderInput = document.getElementById("folderId");
  var message = document.getElementById("message");

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (file && file.lastModified) {
      dateInput.value = Webhard.localDateTimeValue(new Date(file.lastModified));
    }
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    upload();
  });

  async function upload() {
    message.className = "message";
    message.textContent = "업로드 중입니다.";

    var file = fileInput.files && fileInput.files[0];
    if (!file) {
      showError("파일을 선택하세요.");
      return;
    }

    var formData = new FormData();
    formData.append("file", file);
    formData.append("original_created_at", new Date(dateInput.value).toISOString());
    if (folderInput.value) {
      formData.append("folder_id", folderInput.value);
    }

    try {
      var response = await fetch("/file/upload.json", {
        method: "POST",
        headers: Webhard.authHeaders(),
        body: formData
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        showError(body.message || "업로드에 실패했습니다.");
        return;
      }
      message.textContent = "업로드 완료: file_id " + body.data.file_id;
      form.reset();
    } catch (error) {
      showError("업로드 요청에 실패했습니다.");
    }
  }

  function showError(text) {
    message.className = "message error";
    message.textContent = text;
  }
})();
