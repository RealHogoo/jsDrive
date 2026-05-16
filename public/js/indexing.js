(function () {
  "use strict";

  var startButton = document.getElementById("startIndex");
  var refreshButton = document.getElementById("refreshStatus");
  var rebuildButton = document.getElementById("rebuildThumbs");
  var message = document.getElementById("indexMessage");
  var thumbnailMessage = document.getElementById("thumbnailMessage");
  var timer = null;

  startButton.addEventListener("click", startIndexing);
  refreshButton.addEventListener("click", loadStatus);
  rebuildButton.addEventListener("click", rebuildThumbnails);
  loadStatus();

  async function startIndexing() {
    message.className = "message";
    message.textContent = "인덱싱 시작 요청 중입니다.";
    try {
      var data = await Webhard.postJson("/index/start.json", {});
      message.textContent = "인덱싱이 시작되었습니다. 진행 중에는 파일 등록이 차단됩니다.";
      render(data);
      schedule();
    } catch (error) {
      showError(message, error.message || "인덱싱 시작 요청에 실패했습니다.");
    }
  }

  async function loadStatus() {
    try {
      var data = await Webhard.postJson("/index/status.json", {});
      render(data);
      if (data.status_cd === "RUNNING") {
        schedule();
      }
    } catch (error) {
      showError(message, error.message || "상태 조회 요청에 실패했습니다.");
    }
  }

  async function rebuildThumbnails() {
    rebuildButton.disabled = true;
    thumbnailMessage.className = "message";
    thumbnailMessage.textContent = "썸네일을 재생성하는 중입니다.";
    try {
      var totalUpdated = 0;
      var round = 0;
      var hasMore = true;
      while (hasMore && round < 20) {
        var data = await Webhard.postJson("/thumbnail/rebuild.json", { limit: 50 });
        totalUpdated += Number(data.updated_count || 0);
        hasMore = data.has_more === true;
        round++;
        thumbnailMessage.textContent = "재생성 " + totalUpdated + "개 완료";
        if (Number(data.scanned_count || 0) === 0) {
          hasMore = false;
        }
      }
      thumbnailMessage.textContent = totalUpdated > 0
        ? "썸네일 " + totalUpdated + "개를 재생성했습니다."
        : "재생성할 썸네일이 없습니다.";
    } catch (error) {
      showError(thumbnailMessage, error.message || "썸네일 재생성에 실패했습니다.");
    } finally {
      rebuildButton.disabled = false;
    }
  }

  function render(data) {
    var total = Number(data.total_count || 0);
    var indexed = Number(data.indexed_count || 0);
    var skipped = Number(data.skipped_count || 0);
    var errored = Number(data.error_count || 0);
    var done = indexed + skipped + errored;
    var percent = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    document.getElementById("progressBar").style.width = percent + "%";
    document.getElementById("statusCd").textContent = data.status_cd || "IDLE";
    document.getElementById("totalCount").textContent = total;
    document.getElementById("indexedCount").textContent = indexed;
    document.getElementById("skippedCount").textContent = skipped;
    document.getElementById("errorCount").textContent = errored;
    document.getElementById("jobMessage").textContent = data.message || "-";
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(loadStatus, 1500);
  }

  function showError(target, text) {
    target.className = "message error";
    target.textContent = text;
  }
})();
