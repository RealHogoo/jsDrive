(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var weekStart = params.get("week_start") || "";
  var initialKind = params.get("content_kind") || "ALL";
  var initialSortBasis = params.get("sort_basis") || "UPLOADED";
  var initialDownloadJobId = params.get("download_job_id") || "";
  var label = params.get("label") || weekStart;
  var contentKind = document.getElementById("contentKind");
  var sortBasis = document.getElementById("sortBasis");
  var title = document.getElementById("detailTitle");
  var summary = document.getElementById("detailSummary");
  var grid = document.getElementById("detailGrid");
  var sentinel = document.getElementById("detailSentinel");
  var downloadWeek = document.getElementById("downloadWeek");
  var downloadStatus = document.getElementById("downloadStatus");
  var offset = 0;
  var loading = false;
  var hasMore = true;

  title.textContent = label;
  contentKind.value = initialKind;
  sortBasis.value = initialSortBasis;
  downloadWeek.href = "#";
  contentKind.addEventListener("change", resetAndLoad);
  sortBasis.addEventListener("change", resetAndLoad);
  downloadWeek.addEventListener("click", startDownloadJob);
  grid.addEventListener("click", handleGridClick);

  window.addEventListener("scroll", function () {
    if (isPageBottom()) {
      loadMore();
    }
  }, { passive: true });

  resetAndLoad();
  if (initialDownloadJobId) {
    pollDownloadJob(initialDownloadJobId);
  }

  function resetAndLoad() {
    offset = 0;
    hasMore = true;
    loading = false;
    grid.innerHTML = "";
    summary.textContent = "";
    sentinel.textContent = "불러오는 중입니다.";
    loadMore();
  }

  async function startDownloadJob(event) {
    event.preventDefault();
    downloadStatus.textContent = "압축 파일을 만드는 중입니다.";
    try {
      var data = await Webhard.postJson("/download/week/start.json", {
        week_start: weekStart,
        content_kind: contentKind.value,
        sort_basis: sortBasis.value
      });
      pollDownloadJob(data.job_id);
    } catch (error) {
      downloadStatus.textContent = error.message;
    }
  }

  async function pollDownloadJob(jobId) {
    try {
      var data = await Webhard.postJson("/download/status.json", { job_id: jobId });
      if (data.status_cd === "DONE") {
        downloadStatus.innerHTML = "<a class=\"btn primary\" href=\"/download/file/" + encodeURIComponent(jobId) + "\">다운로드</a>";
        return;
      }
      if (data.status_cd === "FAILED") {
        downloadStatus.textContent = data.message || "다운로드 작업에 실패했습니다.";
        return;
      }
      downloadStatus.textContent = "압축 중 " + Number(data.processed_count || 0) + " / " + Number(data.total_count || 0);
      window.setTimeout(function () { pollDownloadJob(jobId); }, 1000);
    } catch (error) {
      downloadStatus.textContent = error.message;
    }
  }

  async function handleGridClick(event) {
    var button = event.target.closest("[data-action=\"delete-file\"]");
    if (!button) {
      return;
    }
    event.preventDefault();
    if (!window.confirm("파일을 휴지통으로 이동할까요?")) {
      return;
    }
    try {
      await Webhard.postJson("/file/delete.json", { file_id: button.getAttribute("data-file-id") });
      var card = button.closest(".preview-card");
      if (card) {
        card.remove();
      }
      summary.textContent = "파일을 휴지통으로 이동했습니다.";
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  async function loadMore() {
    if (loading || !hasMore) {
      return;
    }
    if (!weekStart) {
      summary.textContent = "주차 정보가 없습니다.";
      sentinel.textContent = "";
      hasMore = false;
      return;
    }
    loading = true;
    sentinel.textContent = "불러오는 중입니다.";
    try {
      var data = await Webhard.postJson("/preview/week-items.json", {
        week_start: weekStart,
        offset: offset,
        limit: 10,
        content_kind: contentKind.value,
        sort_basis: sortBasis.value
      });
      var items = data.items || [];
      if (items.length > 0) {
        grid.insertAdjacentHTML("beforeend", items.map(Webhard.mediaCard).join(""));
      }
      offset = data.next_offset || offset + items.length;
      hasMore = data.has_more === true;
      summary.textContent = offset > 0 ? offset + "개 표시 중" : "표시할 파일이 없습니다.";
      sentinel.textContent = hasMore ? "아래로 스크롤하면 다음 10개를 불러옵니다." : "";
    } catch (error) {
      summary.textContent = error.message || "상세 목록을 불러오지 못했습니다.";
      sentinel.textContent = "";
    } finally {
      loading = false;
    }
  }

  function isPageBottom() {
    var doc = document.documentElement;
    return window.innerHeight + window.scrollY >= doc.scrollHeight - 12;
  }
})();
