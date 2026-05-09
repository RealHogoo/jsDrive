(function () {
  "use strict";

  var startButton = document.getElementById("startIndex");
  var refreshButton = document.getElementById("refreshStatus");
  var message = document.getElementById("indexMessage");
  var timer = null;

  startButton.addEventListener("click", startIndexing);
  refreshButton.addEventListener("click", loadStatus);
  loadStatus();

  async function startIndexing() {
    message.className = "message";
    message.textContent = "인덱싱 시작 요청 중입니다.";
    try {
      var response = await fetch("/index/start.json", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, Webhard.authHeaders()),
        body: "{}"
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        showError(body.message || "인덱싱 시작에 실패했습니다.");
        return;
      }
      message.textContent = "인덱싱이 시작되었습니다. 진행 중에는 파일 등록이 차단됩니다.";
      render(body.data);
      schedule();
    } catch (error) {
      showError("인덱싱 시작 요청에 실패했습니다.");
    }
  }

  async function loadStatus() {
    try {
      var response = await fetch("/index/status.json", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, Webhard.authHeaders()),
        body: "{}"
      });
      var body = await response.json();
      if (!response.ok || body.ok !== true) {
        showError(body.message || "상태 조회에 실패했습니다.");
        return;
      }
      render(body.data);
      if (body.data.status_cd === "RUNNING") {
        schedule();
      }
    } catch (error) {
      showError("상태 조회 요청에 실패했습니다.");
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

  function showError(text) {
    message.className = "message error";
    message.textContent = text;
  }
})();
