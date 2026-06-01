(function () {
  "use strict";

  var refreshButton = document.getElementById("refreshDashboard");
  var message = document.getElementById("dashboardMessage");
  var summaryCards = document.getElementById("summaryCards");
  var kindStats = document.getElementById("kindStats");
  var ownerStats = document.getElementById("ownerStats");
  var recentFiles = document.getElementById("recentFiles");
  var duplicateGroups = document.getElementById("duplicateGroups");
  var recentAudit = document.getElementById("recentAudit");

  refreshButton.addEventListener("click", load);
  load();

  async function load() {
    message.textContent = "불러오는 중입니다.";
    try {
      var data = await Webhard.postJson("/dashboard/summary.json", {});
      render(data);
      renderDuplicates(await Webhard.postJson("/file/duplicates.json", {}));
      message.textContent = Webhard.formatDateTime(new Date().toISOString()) + " 기준";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  function render(data) {
    var totals = data.totals || {};
    var folders = data.folders || {};
    var duplicates = data.duplicates || {};
    var todayUploads = data.today_uploads || {};
    var shares = data.shares || {};
    summaryCards.innerHTML = [
      metric("전체 파일", Number(totals.file_count || 0).toLocaleString("ko-KR") + "개"),
      metric("사용 용량", Webhard.formatSize(Number(totals.total_bytes || 0))),
      metric("오늘 업로드", Number(todayUploads.upload_count || 0).toLocaleString("ko-KR") + "개 / " + Webhard.formatSize(Number(todayUploads.upload_bytes || 0))),
      metric("공유 링크", Number(shares.active_share_count || 0).toLocaleString("ko-KR") + "개 활성 / " + Number(shares.share_count || 0).toLocaleString("ko-KR") + "개"),
      metric("휴지통", Number(totals.trash_count || 0).toLocaleString("ko-KR") + "개 / " + Webhard.formatSize(Number(totals.trash_bytes || 0))),
      metric("폴더", Number(folders.folder_count || 0).toLocaleString("ko-KR") + "개"),
      metric("중복 그룹", Number(duplicates.duplicate_group_count || 0).toLocaleString("ko-KR") + "개"),
      metric("정리 가능 추정", Webhard.formatSize(Number(duplicates.reclaimable_bytes || 0)))
    ].join("");

    kindStats.innerHTML = (data.by_kind || []).map(function (item) {
      return row(Webhard.kindLabel(item.content_kind), Number(item.file_count || 0) + "개", Webhard.formatSize(Number(item.total_bytes || 0)));
    }).join("") || "<div class=\"empty compact\">파일이 없습니다.</div>";

    ownerStats.innerHTML = (data.by_owner || []).map(function (item) {
      return row(item.owner_user_id || "-", Number(item.file_count || 0) + "개", Webhard.formatSize(Number(item.total_bytes || 0)));
    }).join("") || "<div class=\"empty compact\">관리자 계정에서 전체 사용자 사용량을 볼 수 있습니다.</div>";

    recentFiles.innerHTML = (data.recent_files || []).map(function (item) {
      var name = item.display_name || item.file_name || "-";
      return row(name, Webhard.kindLabel(item.content_kind), Webhard.formatSize(Number(item.file_size || 0)));
    }).join("") || "<div class=\"empty compact\">최근 파일이 없습니다.</div>";

    recentAudit.innerHTML = (data.recent_audit || []).map(function (item) {
      return row(String(item.action_cd || "-").replace(/_/g, " "), item.actor_user_id || "-", Webhard.formatDateTime(item.created_at));
    }).join("") || "<div class=\"empty compact\">최근 기록이 없습니다.</div>";
  }

  function renderDuplicates(data) {
    duplicateGroups.innerHTML = (data.items || []).map(function (item) {
      return row(String(item.content_sha256 || "").slice(0, 12), Number(item.file_count || 0) + "개", Webhard.formatSize(Number(item.total_bytes || 0)));
    }).join("") || "<div class=\"empty compact\">중복 파일이 없습니다.</div>";
  }

  function metric(label, value) {
    return "<article class=\"metric-card\"><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></article>";
  }

  function row(title, meta, value) {
    return "<div class=\"stat-row\"><strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(meta) + "</span><em>" + escapeHtml(value) + "</em></div>";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
