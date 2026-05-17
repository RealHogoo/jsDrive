(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var fileId = params.get("file_id") || "";
  var fileName = document.getElementById("fileName");
  var viewer = document.getElementById("fileViewer");
  var fileKind = document.getElementById("fileKind");
  var fileSize = document.getElementById("fileSize");
  var fileCreatedAt = document.getElementById("fileCreatedAt");
  var message = document.getElementById("message");
  var download = document.getElementById("downloadFile");

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
    viewer.replaceChildren(mediaElement(item, mediaPath));
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
})();
