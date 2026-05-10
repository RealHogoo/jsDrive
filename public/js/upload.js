(function () {
  "use strict";

  var MAX_FILE_BYTES = 100 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 500 * 1024 * 1024;
  var form = document.getElementById("uploadForm");
  var fileInput = document.getElementById("file");
  var folderInput = document.getElementById("folderId");
  var message = document.getElementById("message");
  var dropZone = document.getElementById("dropZone");
  var fileList = document.getElementById("fileList");
  var clearFiles = document.getElementById("clearFiles");
  var uploadLimitText = document.getElementById("uploadLimitText");
  var selectedFiles = [];

  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (eventName) {
    dropZone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach(function (eventName) {
    dropZone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", function (event) {
    addFiles(event.dataTransfer && event.dataTransfer.files);
  });

  clearFiles.addEventListener("click", function () {
    selectedFiles = [];
    renderFiles();
    message.textContent = "";
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    upload();
  });

  loadUploadLimits();
  renderFiles();

  function addFiles(files) {
    var ignored = 0;
    Array.prototype.forEach.call(files || [], function (file) {
      if (isSupportedFile(file)) {
        selectedFiles.push(file);
      } else {
        ignored++;
      }
    });
    renderFiles();
    if (ignored > 0) {
      showError("지원하지 않는 파일 " + ignored + "개는 제외했습니다.");
    } else if (selectedFiles.length > 0) {
      message.className = "message";
      message.textContent = "";
    }
  }

  function isSupportedFile(file) {
    if (/^(image|video)\//.test(file.type || "")) {
      return true;
    }
    if (/^text\//.test(file.type || "")) {
      return true;
    }
    if (/application\/(pdf|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis|rtf|x-hwp|x-hwpx)/.test(file.type || "")) {
      return true;
    }
    return /\.(pdf|xls|xlsx|csv|ods|doc|docx|ppt|pptx|txt|md|rtf|hwp|hwpx)$/i.test(file.name || "");
  }

  function renderFiles() {
    if (selectedFiles.length === 0) {
      fileList.innerHTML = "<div class=\"empty compact\">선택한 파일이 없습니다.</div>";
      return;
    }
    var totalSize = selectedFiles.reduce(function (sum, file) { return sum + file.size; }, 0);
    fileList.innerHTML = "<div class=\"upload-summary\">"
      + selectedFiles.length + "개 / " + formatSize(totalSize)
      + "</div>"
      + selectedFiles.map(fileRow).join("");
  }

  function fileRow(file, index) {
    var error = file.size > MAX_FILE_BYTES ? " limit-error" : "";
    return "<div class=\"upload-row" + error + "\">"
      + "<div>"
      + "<strong>" + escapeHtml(file.name) + "</strong>"
      + "<span>" + formatSize(file.size) + " / 원본 생성일 " + Webhard.formatDateTime(file.lastModified) + "</span>"
      + "</div>"
      + "<button class=\"btn\" type=\"button\" data-index=\"" + index + "\">삭제</button>"
      + "</div>";
  }

  fileList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-index]");
    if (!button) {
      return;
    }
    selectedFiles.splice(Number(button.getAttribute("data-index")), 1);
    renderFiles();
  });

  async function upload() {
    message.className = "message";
    if (selectedFiles.length === 0) {
      showError("업로드할 파일을 선택하세요.");
      return;
    }
    var totalSize = selectedFiles.reduce(function (sum, file) { return sum + file.size; }, 0);
    if (selectedFiles.some(function (file) { return file.size > MAX_FILE_BYTES; })) {
      showError("단일 파일은 " + formatSize(MAX_FILE_BYTES) + " 이하만 업로드할 수 있습니다.");
      return;
    }
    if (totalSize > MAX_TOTAL_BYTES) {
      showError("전체 파일은 " + formatSize(MAX_TOTAL_BYTES) + " 이하만 업로드할 수 있습니다.");
      return;
    }

    message.textContent = "업로드 중입니다.";
    var formData = new FormData();
    selectedFiles.forEach(function (file) {
      formData.append("files", file);
      formData.append("original_created_at", file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString());
    });
    if (folderInput.value) {
      formData.append("folder_id", folderInput.value);
    }

    try {
      var response = await fetch("/file/upload-batch.json", {
        method: "POST",
        headers: Webhard.authHeaders(),
        body: formData
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        showError(body.message || "업로드에 실패했습니다.");
        return;
      }
      message.textContent = "업로드 완료: " + body.data.count + "개";
      selectedFiles = [];
      renderFiles();
    } catch (error) {
      showError("업로드 요청에 실패했습니다.");
    }
  }

  async function loadUploadLimits() {
    try {
      var response = await fetch("/upload/limits.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        return;
      }
      MAX_FILE_BYTES = Number(body.data.max_file_bytes || MAX_FILE_BYTES);
      MAX_TOTAL_BYTES = Number(body.data.max_total_bytes || MAX_TOTAL_BYTES);
      if (uploadLimitText) {
        uploadLimitText.textContent = "단일 파일 " + formatSize(MAX_FILE_BYTES) + " 이하, 전체 "
          + formatSize(MAX_TOTAL_BYTES) + " 이하";
      }
      renderFiles();
    } catch (error) {
      // 기본값을 그대로 사용한다.
    }
  }

  function showError(text) {
    message.className = "message error";
    message.textContent = text;
  }

  function formatSize(size) {
    return Webhard.formatSize(size);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
