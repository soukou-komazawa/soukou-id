const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyHgXX8JCO5jGQXXMkKMKkaeGUPNZw-xriQhXUghKmY1xumzVQ103bQShE70NySgCx2eA/exec";

/**
 * ローカルストレージキーのプレフィックス
 */
const VOTE_STORAGE_PREFIX = "soukou_nfc_voted_";
const LOCAL_COUNT_CACHE_KEY = "soukou_nfc_counts_cache";

/**
 * アプリケーション状態
 */
const state = {
  masterData: null,
  currentAuthor: null,
  remoteCounts: {}
};

/**
 * 文字列が空白でないか判定
 * @param {any} val
 * @returns {boolean}
 */
function hasText(val) {
  return typeof val === "string" && val.trim() !== "";
}

/**
 * 画像読み込みエラー時に表示する上品なSVGプレースホルダーを生成
 * @param {string} label 表示テキスト
 * @param {number} width 幅
 * @param {number} height 高さ
 * @returns {string} data:image/svg+xml URI
 */
function createFallbackSvgDataUri(label = "No Image", width = 600, height = 400) {
  const safeLabel = String(label).replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#EFECE6"/>
    <rect x="16" y="16" width="${width - 32}" height="${height - 32}" fill="none" stroke="#D5CCC0" stroke-width="1.5" rx="8"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#8C857B" font-family="serif" font-size="18">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * 画像要素にURLとエラー時のフォールバックを設定
 * @param {HTMLImageElement} imgEl
 * @param {string} srcUrl
 * @param {string} fallbackLabel
 */
function setImageWithFallback(imgEl, srcUrl, fallbackLabel) {
  if (!imgEl) return;
  const fallbackUri = createFallbackSvgDataUri(fallbackLabel);
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = fallbackUri;
  };
  imgEl.src = hasText(srcUrl) ? srcUrl.trim() : fallbackUri;
}

/**
 * GAS_API_URL が有効なURLとして設定されているか判定
 */
function isGasConfigured() {
  return (
    typeof GAS_API_URL === "string" &&
    GAS_API_URL.trim() !== "" &&
    GAS_API_URL !== "YOUR_GAS_WEB_APP_URL" &&
    GAS_API_URL.startsWith("https://")
  );
}

/**
 * ローカルキャッシュされたカウント値を取得
 */
function getLocalCountCache() {
  try {
    const raw = localStorage.getItem(LOCAL_COUNT_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("Failed to read localStorage count cache:", err);
    return {};
  }
}

/**
 * ローカルキャッシュのカウント値を保存
 */
function saveLocalCountCache(cacheObj) {
  try {
    localStorage.setItem(LOCAL_COUNT_CACHE_KEY, JSON.stringify(cacheObj));
  } catch (err) {
    console.warn("Failed to save localStorage count cache:", err);
  }
}

/**
 * 特定作品・種別が既にこの端末で投票済みか判定
 * @param {string} workId
 * @param {"like"|"good"} voteType
 */
function hasVoted(workId, voteType) {
  try {
    return localStorage.getItem(`${VOTE_STORAGE_PREFIX}${workId}_${voteType}`) === "1";
  } catch {
    return false;
  }
}

/**
 * 特定作品・種別を投票済みとして記録
 * @param {string} workId
 * @param {"like"|"good"} voteType
 */
function markAsVoted(workId, voteType) {
  try {
    localStorage.setItem(`${VOTE_STORAGE_PREFIX}${workId}_${voteType}`, "1");
  } catch (err) {
    console.warn("localStorage unavailable:", err);
  }
}

/**
 * 作品ごとの現在の表示カウント数を算出
 * @param {Object} work 作品データ
 * @returns {{like: number, good: number}}
 */
function getWorkCounts(work) {
  const baseLike = work.initialCounts?.like ?? 0;
  const baseGood = work.initialCounts?.good ?? 0;
  const remote = state.remoteCounts[work.workId];
  const localCache = getLocalCountCache()[work.workId];

  if (remote) {
    return {
      like: typeof remote.like === "number" ? remote.like : baseLike,
      good: typeof remote.good === "number" ? remote.good : baseGood
    };
  }
  if (localCache) {
    return {
      like: typeof localCache.like === "number" ? localCache.like : baseLike,
      good: typeof localCache.good === "number" ? localCache.good : baseGood
    };
  }
  return { like: baseLike, good: baseGood };
}

/**
 * トースト通知を表示
 * @param {string} message
 */
function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

/**
 * URLパラメータ `?id=` から表示対象の作家を決定する。
 * パラメータが無い場合や一致しない場合はランダムに1人を選択。
 * @param {Array} authors
 * @returns {Object} author
 */
function resolveAuthorFromUrl(authors) {
  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get("id");

  if (requestedId) {
    const matched = authors.find((a) => a.id === requestedId);
    if (matched) return matched;
  }

  const randomIndex = Math.floor(Math.random() * authors.length);
  return authors[randomIndex];
}

/**
 * ファーストビュー：作家プロフィール（デジタル名刺）を描画
 * 空白の項目は自動的に非表示にします。
 * @param {Object} author
 */
function renderAuthorProfile(author) {
  document.title = `${author.name} | デジタル作家名刺＆作品カタログ`;

  const headerImg = document.getElementById("author-header-img");
  const avatarImg = document.getElementById("author-avatar-img");
  const readingEl = document.getElementById("author-reading");
  const nameEl = document.getElementById("author-name");
  const taglineEl = document.getElementById("author-tagline");
  const bioSection = document.getElementById("author-bio-section");
  const bioEl = document.getElementById("author-bio");
  const backgroundSection = document.getElementById("author-background-section");
  const backgroundEl = document.getElementById("author-background");
  const scrollCtaWrap = document.getElementById("scroll-cta-wrap");

  setImageWithFallback(headerImg, author.headerImage, `${author.name} Header`);
  headerImg.alt = `${author.name}のヘッダー背景画像`;

  setImageWithFallback(avatarImg, author.avatarImage, author.name);
  avatarImg.alt = `${author.name}のアイコン画像`;

  nameEl.textContent = author.name || "";

  // ふりがな・ローマ字（空白なら非表示）
  if (hasText(author.reading)) {
    readingEl.textContent = author.reading.trim();
    readingEl.hidden = false;
  } else {
    readingEl.textContent = "";
    readingEl.hidden = true;
  }

  // 一言キャッチコピー（空白なら非表示）
  if (hasText(author.tagline)) {
    taglineEl.textContent = author.tagline.trim();
    taglineEl.hidden = false;
  } else {
    taglineEl.textContent = "";
    taglineEl.hidden = true;
  }

  // 自己紹介と執筆背景（空白のセクションは非表示にし、番号01/02を自動調整）
  let sectionCount = 0;

  if (hasText(author.bio)) {
    sectionCount += 1;
    bioEl.textContent = author.bio.trim();
    const numEl = bioSection.querySelector(".section-label-num");
    if (numEl) numEl.textContent = String(sectionCount).padStart(2, "0");
    bioSection.hidden = false;
  } else {
    bioEl.textContent = "";
    bioSection.hidden = true;
  }

  if (hasText(author.background)) {
    sectionCount += 1;
    backgroundEl.textContent = author.background.trim();
    const numEl = backgroundSection.querySelector(".section-label-num");
    if (numEl) numEl.textContent = String(sectionCount).padStart(2, "0");
    backgroundSection.hidden = false;
  } else {
    backgroundEl.textContent = "";
    backgroundSection.hidden = true;
  }

  // 作品が1件以上ある場合のみスクロール誘導リンクを表示
  const hasWorks = Array.isArray(author.works) && author.works.length > 0;
  if (scrollCtaWrap) {
    scrollCtaWrap.hidden = !hasWorks;
  }
}

/**
 * 作品一覧＆リアクションエリアを描画
 * 各欄で空白の項目は表示しないように制御し、
 * 「ウェブで閲覧できる作品」と「会場の部誌で読む作品」の2種類に対応します。
 * @param {Object} author
 */
function renderWorksList(author) {
  const worksSectionEl = document.getElementById("works-section");
  const worksListEl = document.getElementById("works-list");
  worksListEl.innerHTML = "";

  const validWorks = (author.works || []).filter((w) => hasText(w.title));
  if (validWorks.length === 0) {
    if (worksSectionEl) worksSectionEl.hidden = true;
    return;
  }
  if (worksSectionEl) worksSectionEl.hidden = false;

  validWorks.forEach((work, index) => {
    const counts = getWorkCounts(work);
    const liked = hasVoted(work.workId, "like");
    const gooded = hasVoted(work.workId, "good");

    const article = document.createElement("article");
    article.className = "work-card";
    article.dataset.workId = work.workId;

    const body = document.createElement("div");
    body.className = "work-card-body";

    // 作品番号（No.01 形式）と公開形式バッジ
    const topBar = document.createElement("div");
    topBar.className = "work-card-topbar";

    const workNumber = document.createElement("span");
    workNumber.className = "work-number";
    workNumber.textContent = `No.${String(index + 1).padStart(2, "0")}`;
    topBar.appendChild(workNumber);

    // ウェブ閲覧可能か、会場の部誌かを判定
    const isWebReadable =
      hasText(work.webContent) ||
      (typeof work.format === "string" && work.format.toLowerCase() === "web" && hasText(work.webContent));

    const formatBadge = document.createElement("span");
    if (isWebReadable) {
      formatBadge.className = "work-format-badge is-web";
      formatBadge.textContent = "Webで閲覧可能";
    } else {
      formatBadge.className = "work-format-badge is-book";
      formatBadge.textContent = "会場の部誌に収録";
    }
    topBar.appendChild(formatBadge);
    body.appendChild(topBar);

    // 収録情報と読了目安時間（両方空白ならメタ行自体を非表示）
    const hasBookInfo = hasText(work.bookInfo);
    const hasReadingTime = hasText(work.readingTime);

    if (hasBookInfo || hasReadingTime) {
      const metaHeader = document.createElement("div");
      metaHeader.className = "work-meta-header";

      if (hasBookInfo) {
        const bookInfoSpan = document.createElement("span");
        bookInfoSpan.className = "work-book-info";
        bookInfoSpan.textContent = work.bookInfo.trim();
        metaHeader.appendChild(bookInfoSpan);
      }

      if (hasReadingTime) {
        const readingTimeSpan = document.createElement("span");
        readingTimeSpan.className = "work-reading-time";
        readingTimeSpan.textContent = `読了目安 ${work.readingTime.trim()}`;
        metaHeader.appendChild(readingTimeSpan);
      }

      body.appendChild(metaHeader);
    }

    // 作品タイトル
    const titleH3 = document.createElement("h3");
    titleH3.className = "work-title";
    titleH3.textContent = work.title.trim();
    body.appendChild(titleH3);

    // ジャンル・雰囲気タグ一覧（空白要素を除き、1つ以上ある場合のみ表示）
    const cleanTags = Array.isArray(work.tags)
      ? work.tags.map((t) => String(t).trim()).filter(Boolean)
      : [];
    if (cleanTags.length > 0) {
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "work-tags-list";
      cleanTags.forEach((tagText) => {
        const tagChip = document.createElement("span");
        tagChip.className = "work-tag-chip";
        tagChip.textContent = tagText.startsWith("#") ? tagText : `#${tagText}`;
        tagsWrap.appendChild(tagChip);
      });
      body.appendChild(tagsWrap);
    }

    // 作中の印象的な一文（縦書きキラーフレーズ・空白なら非表示）
    if (hasText(work.quote)) {
      const quoteBox = document.createElement("div");
      quoteBox.className = "work-quote-stage";

      const quoteCaption = document.createElement("span");
      quoteCaption.className = "work-quote-caption";
      quoteCaption.textContent = "本文より";

      const quoteBlock = document.createElement("blockquote");
      quoteBlock.className = "work-vertical-quote";
      quoteBlock.textContent = work.quote.trim();

      quoteBox.append(quoteCaption, quoteBlock);
      body.appendChild(quoteBox);
    }

    // あらすじ（空白なら非表示）
    if (hasText(work.synopsis)) {
      const synopsisBox = document.createElement("div");
      synopsisBox.className = "work-synopsis-box";
      const synopsisLabel = document.createElement("span");
      synopsisLabel.className = "work-synopsis-label";
      synopsisLabel.textContent = "Synopsis";
      const synopsisP = document.createElement("p");
      synopsisP.className = "work-synopsis";
      synopsisP.textContent = work.synopsis.trim();
      synopsisBox.append(synopsisLabel, synopsisP);
      body.appendChild(synopsisBox);
    }

    // 作者からのひとこと（空白なら非表示）
    if (hasText(work.authorComment)) {
      const bubbleWrap = document.createElement("div");
      bubbleWrap.className = "author-comment-bubble";
      const bubbleAvatar = document.createElement("img");
      bubbleAvatar.className = "bubble-avatar";
      bubbleAvatar.loading = "lazy";
      bubbleAvatar.alt = author.name;
      setImageWithFallback(bubbleAvatar, author.avatarImage, author.name);

      const bubbleContent = document.createElement("div");
      bubbleContent.className = "bubble-content";
      const bubbleLabel = document.createElement("span");
      bubbleLabel.className = "bubble-label";
      bubbleLabel.textContent = `${author.name}より`;
      const bubbleText = document.createElement("p");
      bubbleText.textContent = work.authorComment.trim();
      bubbleContent.append(bubbleLabel, bubbleText);
      bubbleWrap.append(bubbleAvatar, bubbleContent);
      body.appendChild(bubbleWrap);
    }

    // 作品の閲覧アクション（① ウェブで全文を読むボタン または ② 展示会場の部誌案内ボックス）
    if (isWebReadable) {
      const readWebBtn = document.createElement("button");
      readWebBtn.type = "button";
      readWebBtn.className = "web-read-btn";
      readWebBtn.textContent = "📖 ウェブで作品を読む";
      readWebBtn.addEventListener("click", () => {
        openReaderModal(author, work);
      });
      body.appendChild(readWebBtn);
    } else {
      const bookNotice = document.createElement("div");
      bookNotice.className = "book-only-notice";
      const noticeIcon = document.createElement("span");
      noticeIcon.className = "book-only-notice-badge";
      noticeIcon.textContent = "展示会場・部誌収録";
      const noticeText = document.createElement("p");
      noticeText.className = "book-only-notice-text";
      noticeText.textContent = hasBookInfo
        ? `本作は展示会場の「${work.bookInfo.trim()}」にてお読みいただけます。ぜひブースでお手に取ってご覧ください。`
        : "本作は展示会場にて頒布・展示している部誌でお読みいただけます。ぜひブースでお手に取ってご覧ください。";
      bookNotice.append(noticeIcon, noticeText);
      body.appendChild(bookNotice);
    }

    // ワンタップ投票ボタン（2種類）
    const reactionSection = document.createElement("div");
    reactionSection.className = "reaction-section";
    const reactionTitle = document.createElement("p");
    reactionTitle.className = "reaction-title";
    reactionTitle.textContent = "Reaction";

    const reactionBtns = document.createElement("div");
    reactionBtns.className = "reaction-buttons";

    const likeBtn = createVoteButton({
      authorId: author.id,
      work,
      voteType: "like",
      label: "💡 あらすじが気になる！",
      initialCount: counts.like,
      alreadyVoted: liked
    });

    const goodBtn = createVoteButton({
      authorId: author.id,
      work,
      voteType: "good",
      label: "👏 面白かった！",
      initialCount: counts.good,
      alreadyVoted: gooded
    });

    reactionBtns.append(likeBtn, goodBtn);
    reactionSection.append(reactionTitle, reactionBtns);

    // 一言コメント送信フォーム
    const commentForm = createCommentForm(author.id, work);

    body.append(reactionSection, commentForm);

    article.appendChild(body);
    worksListEl.appendChild(article);
  });
}

/**
 * ウェブ公開作品の全文読書モーダルを開く
 * @param {Object} author
 * @param {Object} work
 */
function openReaderModal(author, work) {
  const dialog = document.getElementById("reader-dialog");
  const titleEl = document.getElementById("reader-dialog-title");
  const metaEl = document.getElementById("reader-dialog-meta");
  const contentEl = document.getElementById("reader-dialog-content");
  const authorEl = document.getElementById("reader-dialog-author");
  const bodyEl = document.getElementById("reader-dialog-body");
  if (!dialog) return;

  titleEl.textContent = work.title || "";
  metaEl.textContent = hasText(work.readingTime)
    ? `Web Reading · 読了目安 ${work.readingTime.trim()}`
    : "Web Reading";
  authorEl.textContent = `著：${author.name}`;

  // 段落ごとに整形して描画
  contentEl.innerHTML = "";
  const paragraphs = String(work.webContent || "").split(/\r?\n/);
  paragraphs.forEach((line) => {
    if (line.trim() === "") {
      const spacer = document.createElement("div");
      spacer.className = "reader-paragraph-spacer";
      contentEl.appendChild(spacer);
    } else {
      const p = document.createElement("p");
      p.className = "reader-paragraph";
      p.textContent = line;
      contentEl.appendChild(p);
    }
  });

  dialog.showModal();
  if (bodyEl) bodyEl.scrollTop = 0;
}

/**
 * `<dialog closedby="any">` 非対応ブラウザ向けのライトディスミス（背景クリック閉じ）フォールバック
 */
function setupDialogBackdropFallback() {
  if ("closedBy" in HTMLDialogElement.prototype) return;

  const dialogs = document.querySelectorAll("dialog.reader-dialog");
  dialogs.forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (isDialogContent) return;
      dialog.close();
    });
  });
}

/**
 * ワンタップ投票ボタン要素を生成
 */
function createVoteButton({ authorId, work, voteType, label, initialCount, alreadyVoted }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `vote-btn${alreadyVoted ? " is-voted" : ""}`;
  btn.disabled = alreadyVoted;
  btn.dataset.workId = work.workId;
  btn.dataset.voteType = voteType;

  const labelSpan = document.createElement("span");
  labelSpan.className = "vote-btn-label";
  labelSpan.textContent = label;

  const countSpan = document.createElement("span");
  countSpan.className = "vote-btn-count";
  countSpan.textContent = String(initialCount);

  btn.append(labelSpan, countSpan);

  btn.addEventListener("click", () => {
    if (hasVoted(work.workId, voteType)) return;

    // Optimistic UI: 押した瞬間にUI上の数字を+1し、ボタンをアクティブ化
    const currentVal = parseInt(countSpan.textContent, 10) || 0;
    const nextVal = currentVal + 1;
    countSpan.textContent = String(nextVal);
    btn.classList.add("is-voted");
    btn.disabled = true;

    markAsVoted(work.workId, voteType);

    // ローカルキャッシュにも反映
    const cache = getLocalCountCache();
    const currentWorkCounts = getWorkCounts(work);
    cache[work.workId] = {
      ...currentWorkCounts,
      [voteType]: nextVal
    };
    saveLocalCountCache(cache);
    if (state.remoteCounts[work.workId]) {
      state.remoteCounts[work.workId][voteType] = nextVal;
    }

    // 裏でGASへPOST送信
    sendPostToGas({
      action: "vote",
      authorId,
      workId: work.workId,
      voteType,
      timestamp: new Date().toISOString()
    });
  });

  return btn;
}

/**
 * 一言コメント送信フォームを生成
 */
function createCommentForm(authorId, work) {
  const form = document.createElement("form");
  form.className = "comment-form";

  const label = document.createElement("label");
  label.className = "comment-label";
  const inputId = `comment-input-${work.workId}`;
  label.htmlFor = inputId;
  label.textContent = "Message";

  const row = document.createElement("div");
  row.className = "comment-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.id = inputId;
  input.className = "comment-input";
  input.placeholder = "感想や応援メッセージを気軽に送れます（匿名）";
  input.maxLength = 200;
  input.required = true;

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "comment-submit-btn";
  submitBtn.textContent = "送信";

  const feedback = document.createElement("p");
  feedback.className = "comment-feedback";
  feedback.setAttribute("aria-live", "polite");

  row.append(input, submitBtn);
  form.append(label, row, feedback);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const commentText = input.value.trim();
    if (!commentText) return;

    submitBtn.disabled = true;
    input.disabled = true;
    submitBtn.textContent = "送信中...";
    feedback.textContent = "";

    await sendPostToGas({
      action: "comment",
      authorId,
      workId: work.workId,
      comment: commentText,
      timestamp: new Date().toISOString()
    });

    input.value = "";
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "送信";

    const thanksMsg = "送信しました！ありがとうございます！";
    feedback.textContent = thanksMsg;
    showToast(thanksMsg);
  });

  return form;
}

/**
 * フッター：「他の作家の名刺も見る」エリアを描画
 */
function renderOtherAuthors(authors, currentAuthorId) {
  const grid = document.getElementById("other-authors-grid");
  grid.innerHTML = "";

  authors.forEach((author) => {
    const isCurrent = author.id === currentAuthorId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `author-switch-btn${isCurrent ? " is-active" : ""}`;
    btn.setAttribute("aria-current", isCurrent ? "true" : "false");

    const avatar = document.createElement("img");
    avatar.className = "switch-avatar";
    avatar.loading = "lazy";
    avatar.alt = author.name;
    setImageWithFallback(avatar, author.avatarImage, author.name);

    const nameSpan = document.createElement("span");
    nameSpan.className = "switch-name";
    nameSpan.textContent = author.name;

    const statusSpan = document.createElement("span");
    statusSpan.className = "switch-status";
    statusSpan.textContent = isCurrent ? "表示中" : "名刺を見る";

    btn.append(avatar, nameSpan, statusSpan);

    btn.addEventListener("click", () => {
      if (state.currentAuthor && state.currentAuthor.id === author.id) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      switchAuthor(author.id, true);
    });

    grid.appendChild(btn);
  });
}

/**
 * フッター：サークル＆部誌紹介エリアを描画
 * 空白の項目は自動的に非表示にします。
 */
function renderCircleInfo(circle) {
  const sectionEl = document.getElementById("circle-info-section");
  if (!circle) {
    if (sectionEl) sectionEl.hidden = true;
    return;
  }

  const logoImg = document.getElementById("circle-logo-img");
  if (hasText(circle.logoImage)) {
    logoImg.hidden = false;
    setImageWithFallback(logoImg, circle.logoImage, circle.name || "Circle");
    logoImg.alt = `${circle.name || "サークル"} ロゴ`;
  } else {
    logoImg.hidden = true;
  }

  const subtitleEl = document.getElementById("circle-subtitle");
  if (hasText(circle.subtitle)) {
    subtitleEl.textContent = circle.subtitle.trim();
    subtitleEl.hidden = false;
  } else {
    subtitleEl.textContent = "";
    subtitleEl.hidden = true;
  }

  const nameEl = document.getElementById("circle-info-heading");
  nameEl.textContent = circle.name || "";

  const descEl = document.getElementById("circle-description");
  if (hasText(circle.description)) {
    descEl.textContent = circle.description.trim();
    descEl.hidden = false;
  } else {
    descEl.textContent = "";
    descEl.hidden = true;
  }

  const metaBookItem = document.getElementById("circle-meta-book");
  const bookTitleEl = document.getElementById("circle-book-title");
  if (hasText(circle.bookTitle)) {
    bookTitleEl.textContent = circle.bookTitle.trim();
    if (metaBookItem) metaBookItem.hidden = false;
  } else if (metaBookItem) {
    metaBookItem.hidden = true;
  }

  const metaPriceItem = document.getElementById("circle-meta-price");
  const priceEl = document.getElementById("circle-price");
  if (hasText(circle.price)) {
    priceEl.textContent = circle.price.trim();
    if (metaPriceItem) metaPriceItem.hidden = false;
  } else if (metaPriceItem) {
    metaPriceItem.hidden = true;
  }

  const metaBoothItem = document.getElementById("circle-meta-booth");
  const boothEl = document.getElementById("circle-booth");
  if (hasText(circle.boothLocation)) {
    boothEl.textContent = circle.boothLocation.trim();
    if (metaBoothItem) metaBoothItem.hidden = false;
  } else if (metaBoothItem) {
    metaBoothItem.hidden = true;
  }

  const metaListEl = document.getElementById("circle-meta-list");
  if (metaListEl) {
    const anyMeta =
      hasText(circle.bookTitle) || hasText(circle.price) || hasText(circle.boothLocation);
    metaListEl.hidden = !anyMeta;
  }

  // 「📖 部誌の詳細を見る」「🏛️ サークルの詳細を見る」ボタンの表示制御とクリック処理
  const actionsWrap = document.getElementById("circle-detail-actions");
  const bookBtn = document.getElementById("open-book-detail-btn");
  const circleBtn = document.getElementById("open-circle-detail-btn");

  const hasBookDetail =
    hasText(circle.bookDescription) ||
    hasText(circle.bookCoverImage) ||
    hasText(circle.bookTitle);
  const hasCircleDetail =
    hasText(circle.circleDetail) ||
    hasText(circle.activityInfo) ||
    hasText(circle.snsUrl) ||
    hasText(circle.websiteUrl);

  if (bookBtn) {
    bookBtn.hidden = !hasBookDetail;
    bookBtn.onclick = () => openBookDetailModal(circle, state.masterData?.authors || []);
  }
  if (circleBtn) {
    circleBtn.hidden = !hasCircleDetail;
    circleBtn.onclick = () => openCircleDetailModal(circle);
  }
  if (actionsWrap) {
    actionsWrap.hidden = !hasBookDetail && !hasCircleDetail;
  }
}

/**
 * 複数行テキストを段落要素としてコンテナに追加するヘルパー
 */
function appendFormattedParagraphs(container, text) {
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((line) => {
    if (line.trim() === "") {
      const spacer = document.createElement("div");
      spacer.className = "reader-paragraph-spacer";
      container.appendChild(spacer);
    } else {
      const p = document.createElement("p");
      p.className = "reader-paragraph";
      p.textContent = line;
      container.appendChild(p);
    }
  });
}

/**
 * 「📖 部誌の詳細を見る」ポップアップモーダルを開く
 */
function openBookDetailModal(circle, authors) {
  const dialog = document.getElementById("info-dialog");
  const badgeEl = document.getElementById("info-dialog-badge");
  const titleEl = document.getElementById("info-dialog-title");
  const bodyEl = document.getElementById("info-dialog-body");
  const subfooterEl = document.getElementById("info-dialog-subfooter");
  if (!dialog || !bodyEl) return;

  badgeEl.textContent = "Anthology & Booklet";
  titleEl.textContent = hasText(circle.bookTitle) ? circle.bookTitle.trim() : "頒布部誌のご案内";
  subfooterEl.textContent = hasText(circle.name) ? circle.name.trim() : "";

  bodyEl.innerHTML = "";

  // 部誌の表紙画像（設定されている場合のみ表示）
  if (hasText(circle.bookCoverImage)) {
    const coverWrap = document.createElement("div");
    coverWrap.className = "info-modal-cover-wrap";
    const coverImg = document.createElement("img");
    coverImg.className = "info-modal-cover-img";
    coverImg.alt = titleEl.textContent;
    setImageWithFallback(coverImg, circle.bookCoverImage, titleEl.textContent);
    coverWrap.appendChild(coverImg);
    bodyEl.appendChild(coverWrap);
  }

  // 仕様・価格・展示ブース情報ボックス
  if (hasText(circle.price) || hasText(circle.boothLocation)) {
    const specBox = document.createElement("dl");
    specBox.className = "info-modal-spec-list";

    if (hasText(circle.price)) {
      const item = document.createElement("div");
      item.className = "info-modal-spec-item";
      const dt = document.createElement("dt");
      dt.textContent = "仕様・頒布価格";
      const dd = document.createElement("dd");
      dd.textContent = circle.price.trim();
      item.append(dt, dd);
      specBox.appendChild(item);
    }

    if (hasText(circle.boothLocation)) {
      const item = document.createElement("div");
      item.className = "info-modal-spec-item";
      const dt = document.createElement("dt");
      dt.textContent = "頒布場所";
      const dd = document.createElement("dd");
      dd.textContent = circle.boothLocation.trim();
      item.append(dt, dd);
      specBox.appendChild(item);
    }

    bodyEl.appendChild(specBox);
  }

  // 部誌の詳細説明文
  const descText = hasText(circle.bookDescription)
    ? circle.bookDescription.trim()
    : hasText(circle.description)
      ? circle.description.trim()
      : "";
  if (descText) {
    const secTitle = document.createElement("h4");
    secTitle.className = "info-modal-section-title";
    secTitle.textContent = "About This Book / 部誌について";
    bodyEl.appendChild(secTitle);

    const prose = document.createElement("div");
    prose.className = "info-modal-prose";
    appendFormattedParagraphs(prose, descText);
    bodyEl.appendChild(prose);
  }

  // 収録作品一覧（全作家の作品から自動生成）
  const allWorks = [];
  (authors || []).forEach((author) => {
    (author.works || []).forEach((work) => {
      if (hasText(work.title)) {
        allWorks.push({ author, work });
      }
    });
  });

  if (allWorks.length > 0) {
    const tocTitle = document.createElement("h4");
    tocTitle.className = "info-modal-section-title";
    tocTitle.textContent = "Contents / 収録・公開作品一覧";
    bodyEl.appendChild(tocTitle);

    const tocList = document.createElement("ul");
    tocList.className = "info-modal-toc-list";

    allWorks.forEach(({ author, work }) => {
      const li = document.createElement("li");
      li.className = "info-modal-toc-item";

      const topRow = document.createElement("div");
      topRow.className = "info-modal-toc-row";

      const wTitle = document.createElement("span");
      wTitle.className = "info-modal-toc-work";
      wTitle.textContent = `『${work.title.trim()}』`;

      const wAuthor = document.createElement("span");
      wAuthor.className = "info-modal-toc-author";
      wAuthor.textContent = author.name;

      topRow.append(wTitle, wAuthor);
      li.appendChild(topRow);

      if (hasText(work.bookInfo)) {
        const sub = document.createElement("span");
        sub.className = "info-modal-toc-meta";
        sub.textContent = work.bookInfo.trim();
        li.appendChild(sub);
      }

      tocList.appendChild(li);
    });

    bodyEl.appendChild(tocList);
  }

  dialog.showModal();
  bodyEl.scrollTop = 0;
}

/**
 * 「🏛️ サークルの詳細を見る」ポップアップモーダルを開く
 */
function openCircleDetailModal(circle) {
  const dialog = document.getElementById("info-dialog");
  const badgeEl = document.getElementById("info-dialog-badge");
  const titleEl = document.getElementById("info-dialog-title");
  const bodyEl = document.getElementById("info-dialog-body");
  const subfooterEl = document.getElementById("info-dialog-subfooter");
  if (!dialog || !bodyEl) return;

  badgeEl.textContent = "About Our Circle";
  titleEl.textContent = hasText(circle.name) ? circle.name.trim() : "サークル詳細";
  subfooterEl.textContent = hasText(circle.subtitle) ? circle.subtitle.trim() : "";

  bodyEl.innerHTML = "";

  // サークル詳細プロフィール文
  const detailText = hasText(circle.circleDetail)
    ? circle.circleDetail.trim()
    : hasText(circle.description)
      ? circle.description.trim()
      : "";
  if (detailText) {
    const secTitle = document.createElement("h4");
    secTitle.className = "info-modal-section-title";
    secTitle.textContent = "Introduction / サークル紹介";
    bodyEl.appendChild(secTitle);

    const prose = document.createElement("div");
    prose.className = "info-modal-prose";
    appendFormattedParagraphs(prose, detailText);
    bodyEl.appendChild(prose);
  }

  // 活動情報・展示ブース
  if (hasText(circle.activityInfo) || hasText(circle.boothLocation)) {
    const secTitle = document.createElement("h4");
    secTitle.className = "info-modal-section-title";
    secTitle.textContent = "Information / 活動・ブース情報";
    bodyEl.appendChild(secTitle);

    const specBox = document.createElement("dl");
    specBox.className = "info-modal-spec-list";

    if (hasText(circle.activityInfo)) {
      const item = document.createElement("div");
      item.className = "info-modal-spec-item";
      const dt = document.createElement("dt");
      dt.textContent = "普段の活動";
      const dd = document.createElement("dd");
      dd.textContent = circle.activityInfo.trim();
      item.append(dt, dd);
      specBox.appendChild(item);
    }

    if (hasText(circle.boothLocation)) {
      const item = document.createElement("div");
      item.className = "info-modal-spec-item";
      const dt = document.createElement("dt");
      dt.textContent = "展示ブース";
      const dd = document.createElement("dd");
      dd.textContent = circle.boothLocation.trim();
      item.append(dt, dd);
      specBox.appendChild(item);
    }

    bodyEl.appendChild(specBox);
  }

  // 公式SNS・Webサイトリンク（設定されている場合のみ表示）
  if (hasText(circle.snsUrl) || hasText(circle.websiteUrl)) {
    const linksWrap = document.createElement("div");
    linksWrap.className = "info-modal-links";

    if (hasText(circle.snsUrl)) {
      const snsLink = document.createElement("a");
      snsLink.className = "info-modal-link-btn";
      snsLink.href = circle.snsUrl.trim();
      snsLink.target = "_blank";
      snsLink.rel = "noopener noreferrer";
      snsLink.textContent = "公式SNSを見る ↗";
      linksWrap.appendChild(snsLink);
    }

    if (hasText(circle.websiteUrl)) {
      const webLink = document.createElement("a");
      webLink.className = "info-modal-link-btn";
      webLink.href = circle.websiteUrl.trim();
      webLink.target = "_blank";
      webLink.rel = "noopener noreferrer";
      webLink.textContent = "公式Webサイトを見る ↗";
      linksWrap.appendChild(webLink);
    }

    bodyEl.appendChild(linksWrap);
  }

  dialog.showModal();
  bodyEl.scrollTop = 0;
}

/**
 * ページ遷移なしで作家の表示を切り替え、URLの `?id=` も history.pushState で更新
 */
function switchAuthor(authorId, pushHistory = true) {
  if (!state.masterData) return;
  const target = state.masterData.authors.find((a) => a.id === authorId);
  if (!target) return;

  state.currentAuthor = target;

  if (pushHistory) {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("id", target.id);
    window.history.pushState({ authorId: target.id }, "", newUrl.toString());
  }

  renderAuthorProfile(target);
  renderWorksList(target);
  renderOtherAuthors(state.masterData.authors, target.id);

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * GASの doGet から最新の投票カウント一覧を取得
 */
async function fetchCountsFromGas() {
  if (!isGasConfigured()) {
    console.info(
      "[Mock Mode] GAS_API_URL が未設定のため、ローカル初期値＆キャッシュで動作します。"
    );
    return;
  }

  try {
    const response = await fetch(GAS_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data && data.counts) {
      state.remoteCounts = data.counts;
      if (state.currentAuthor) {
        renderWorksList(state.currentAuthor);
      }
    }
  } catch (err) {
    console.warn("GASからの集計データ取得に失敗しました（ローカル値を使用します）:", err);
  }
}

/**
 * GASの doPost へ投票またはコメントデータを送信
 * CORSプリフライト回避のため Content-Type: text/plain でJSON文字列を送信
 */
async function sendPostToGas(payload) {
  if (!isGasConfigured()) {
    console.info("[Mock Mode] GAS POST Payload:", payload);
    // モック動作時は少しだけウェイトを入れてリアルな非同期感を再現
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { status: "mock_ok" };
  }

  try {
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    return result;
  } catch (err) {
    console.warn("GASへのPOST送信中にエラーが発生しました:", err);
    return { status: "error", message: String(err) };
  }
}

/**
 * 初期化処理
 */
async function initApp() {
  setupDialogBackdropFallback();

  try {
    const res = await fetch("authors.json");
    if (!res.ok) throw new Error(`Failed to load authors.json (${res.status})`);
    const data = await res.json();
    state.masterData = data;

    const initialAuthor = resolveAuthorFromUrl(data.authors);
    state.currentAuthor = initialAuthor;

    // URLに ?id= が無かった場合も現在のURLバーに反映しておく（履歴は汚さないよう replaceState）
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("id") !== initialAuthor.id) {
      currentUrl.searchParams.set("id", initialAuthor.id);
      window.history.replaceState({ authorId: initialAuthor.id }, "", currentUrl.toString());
    }

    renderAuthorProfile(initialAuthor);
    renderWorksList(initialAuthor);
    renderOtherAuthors(data.authors, initialAuthor.id);
    renderCircleInfo(data.circle);

    // ブラウザの戻る・進むボタン対応
    window.addEventListener("popstate", () => {
      const author = resolveAuthorFromUrl(state.masterData.authors);
      switchAuthor(author.id, false);
    });

    // バックエンドGASから最新の投票数を非同期取得
    await fetchCountsFromGas();
  } catch (err) {
    console.error("アプリケーションの初期化に失敗しました:", err);
    document.getElementById("author-name").textContent = "データの読み込みに失敗しました";
  }
}

document.addEventListener("DOMContentLoaded", initApp);
