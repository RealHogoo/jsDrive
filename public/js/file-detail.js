(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var fileId = params.get("file_id") || "";
  var fileName = document.getElementById("fileName");
  var viewer = document.getElementById("fileViewer");
  var fileKind = document.getElementById("fileKind");
  var fileSize = document.getElementById("fileSize");
  var fileCreatedAt = document.getElementById("fileCreatedAt");
  var fileHash = document.getElementById("fileHash");
  var message = document.getElementById("message");
  var download = document.getElementById("downloadFile");
  var metadataForm = document.getElementById("metadataForm");
  var moveForm = document.getElementById("moveForm");
  var shareForm = document.getElementById("shareForm");
  var shareResult = document.getElementById("shareResult");
  var duplicateList = document.getElementById("duplicateList");

  metadataForm.addEventListener("submit", saveMetadata);
  moveForm.addEventListener("submit", moveFile);
  shareForm.addEventListener("submit", createShare);

  load();

  async function load() {
    if (!fileId) {
      message.textContent = "파일 정보가 없습니다.";
      return;
    }
    download.href = "/file/download/" + encodeURIComponent(fileId);
    try {
      var data = await Webhard.postJson("/file/detail.json", { file_id: fileId });
      render(data);
    } catch (error) {
      message.textContent = error.message || "파일 정보를 불러오지 못했습니다.";
    }
  }

  function render(item) {
    var mediaPath = "/file/content/" + encodeURIComponent(item.file_id);
    fileName.textContent = item.file_name || "파일 상세";
    fileKind.textContent = Webhard.kindLabel(item.content_kind);
    fileSize.textContent = Webhard.formatSize(Number(item.file_size || 0));
    fileCreatedAt.textContent = Webhard.formatDateTime(item.original_created_at);
    fileHash.textContent = item.content_sha256 ? String(item.content_sha256).slice(0, 12) : "-";
    document.getElementById("editFileName").value = item.file_name || "";
    document.getElementById("displayName").value = item.display_name || "";
    document.getElementById("fileMemo").value = item.memo || "";
    document.getElementById("fileTags").value = item.tags || "";
    document.getElementById("targetFolderId").value = item.folder_id || "";
    renderDuplicates(item.duplicates || []);
    viewer.replaceChildren(mediaElement(item, mediaPath));
  }

  async function saveMetadata(event) {
    event.preventDefault();
    try {
      await Webhard.postJson("/file/metadata.json", {
        file_id: fileId,
        file_name: document.getElementById("editFileName").value,
        display_name: document.getElementById("displayName").value,
        memo: document.getElementById("fileMemo").value,
        tags: document.getElementById("fileTags").value
      });
      message.textContent = "표시 정보를 저장했습니다.";
      load();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function moveFile(event) {
    event.preventDefault();
    try {
      await Webhard.postJson("/file/move.json", {
        file_id: fileId,
        folder_id: document.getElementById("targetFolderId").value
      });
      message.textContent = "파일 위치를 이동했습니다.";
      load();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function createShare(event) {
    event.preventDefault();
    try {
      var data = await Webhard.postJson("/share/create.json", {
        file_id: fileId,
        expires_at: document.getElementById("shareExpiresAt").value,
        password: document.getElementById("sharePassword").value,
        max_download_count: document.getElementById("shareMaxDownloads").value
      });
      shareResult.textContent = "공유 토큰: " + data.share_token;
    } catch (error) {
      shareResult.textContent = error.message;
    }
  }

  function renderDuplicates(items) {
    duplicateList.innerHTML = items.length
      ? items.map(function (item) {
        return "<div class=\"stat-row\"><strong>" + escapeHtml(item.display_name || item.file_name) + "</strong>"
          + "<span>#" + escapeHtml(item.file_id) + "</span>"
          + "<em>" + Webhard.formatSize(Number(item.file_size || 0)) + "</em></div>";
      }).join("")
      : "<div class=\"empty compact\">중복 파일이 없습니다.</div>";
  }

  function mediaElement(item, mediaPath) {
    if (item.content_kind === "VIDEO") {
      var video = document.createElement("video");
      video.className = "detail-media";
      video.src = mediaPath;
      video.controls = true;
      video.autoplay = true;
      return video;
    }
    if (item.content_kind === "IMAGE") {
      var image = document.createElement("img");
      image.className = "detail-media";
      image.src = mediaPath;
      image.alt = "";
      return image;
    }
    var box = document.createElement("div");
    var title = document.createElement("strong");
    var hint = document.createElement("span");
    box.className = "document-detail";
    title.textContent = item.file_name || "문서 파일";
    hint.textContent = "브라우저 미리보기를 지원하지 않는 문서는 다운로드해서 확인하세요.";
    box.appendChild(title);
    box.appendChild(hint);
    return box;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
