// --- START OF REPLACEMENT FILE: script.js ---
document.addEventListener('DOMContentLoaded', async () => {
  const uploadArea = document.querySelector('.upload-area');
  const fileInput = document.getElementById('image-upload');
  const thumbnailsContainer = document.getElementById('thumbnails-container');
  const promptInput = document.getElementById('prompt-input');
  const generateBtn = document.getElementById('generate-btn');
  const btnText = generateBtn.querySelector('.btn-text');
  const spinner = generateBtn.querySelector('.spinner');
  const resultContainer = document.getElementById('result-image-container');
  const tplBtns = document.querySelectorAll('.tpl-btn');
  const countInput = document.getElementById('count-input');
  const sizeInput = document.getElementById('size-input');
  const styleInput = document.getElementById('style-input');
  const historyContainer = document.getElementById('history-container');
  const feedbackBtn = document.getElementById('feedback-btn');
  const feedbackDialog = document.getElementById('feedback-dialog');
  const feedbackSubmit = document.getElementById('feedback-submit');
  const feedbackCancel = document.getElementById('feedback-cancel');
  const feedbackText = document.getElementById('feedback-text');
  const providerSelect = document.getElementById('provider-select');

  let selectedFiles = []; // {file, key}

  // --- 新增：加载并填充服务商列表 ---
  async function loadProviders() {
    try {
      const response = await fetch('/api/providers');
      if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || '无法加载服务商列表');
      }
      const providers = await response.json();
      
      if (!providers || providers.length === 0) {
        alert('管理员尚未配置任何 AI 服务商，功能暂时无法使用。');
        generateBtn.disabled = true;
        providerSelect.innerHTML = '<option>无可用服务</option>';
        return;
      }

      providerSelect.innerHTML = ''; // 清空
      providers.forEach(p => {
        const option = document.createElement('option');
        option.value = p.name;
        option.textContent = p.name;
        providerSelect.appendChild(option);
      });
    } catch (e) {
      console.error('加载服务商失败', e);
      alert('加载服务商配置失败: ' + e.message);
      generateBtn.disabled = true;
    }
  }
  
  await loadProviders(); // 页面加载时执行

  // 历史初始化
  loadHistory();
  
  // 上传区域点击
  uploadArea.addEventListener('click', () => fileInput.click());

  // 拖放与选择
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
    uploadArea.addEventListener(ev, preventDefaults, false)
  );
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ['dragenter', 'dragover'].forEach(ev => uploadArea.addEventListener(ev, () => uploadArea.classList.add('drag-over')));
  ['dragleave', 'drop'].forEach(ev => uploadArea.addEventListener(ev, () => uploadArea.classList.remove('drag-over')));

  uploadArea.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
  });
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
    e.target.value = ''; // 重复选择同一张图也能触发
  });

  function buildFingerprint(file) { return `${file.name}__${file.size}__${file.lastModified}`; }
  function handleFiles(files) {
    files.forEach(file => {
      const key = buildFingerprint(file);
      if (!selectedFiles.some(it => it.key === key)) {
        selectedFiles.push({ file, key });
        createThumbnail(file, key);
      }
    });
  }

  function createThumbnail(file, key) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-wrapper';
      const img = document.createElement('img');
      img.src = e.target.result;
      img.alt = file.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', '移除图片');
      removeBtn.textContent = '×';
      removeBtn.onclick = (ev) => {
        ev.stopPropagation();
        selectedFiles = selectedFiles.filter(it => it.key !== key);
        wrapper.remove();
      };

      wrapper.appendChild(img);
      wrapper.appendChild(removeBtn);
      thumbnailsContainer.appendChild(wrapper);
    };
    reader.readAsDataURL(file);
  }

  // 模板注入
  tplBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.dataset.tpl || '';
      const origin = promptInput.value.trim();
      promptInput.value = origin ? `${origin}\n${tpl}` : tpl;
    });
  });

  // 生成逻辑
  generateBtn.addEventListener('click', async () => {
    if (!promptInput.value.trim()) {
      alert('请输入提示词');
      return;
    }
    const count = Math.min(Math.max(parseInt(countInput.value || '1', 10), 1), 4);

    setLoading(true);
    safeSetResultStatus('正在准备数据...');

    try {
      const base64Images = await Promise.all(
        selectedFiles.map(({ file }) => fileToCompressedDataURL(file, 1280, 1280, 0.9))
      );

      safeSetResultStatus('正在请求 AI 生成...');

      const payload = {
        providerName: providerSelect.value, // 使用下拉框的当前值
        prompt: decoratePrompt(promptInput.value, sizeInput.value, styleInput.value),
        images: base64Images,
        count,
      };

      const resp = await fetch('/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (data?.error) {
        safeSetResultStatus(`生成失败：${data.error}${data?.detail?.snippet ? ` | ${data.detail.snippet}` : ''}`);
        return;
      }

      const images = Array.isArray(data?.images) ? data.images : [];
      if (images.length === 0 && data?.retry) {
        safeSetResultStatus(`模型仅返回文本，请稍后再试或更换提示词：${data.message || ''}`);
        return;
      }
      if (images.length === 0) {
        safeSetResultStatus('生成失败：模型未返回任何图片。');
        return;
      }

      // 展示与历史
      showImages(images);
      appendHistory(images, payload.prompt);

    } catch (e) {
      safeSetResultStatus(`生成失败：${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  });

  function decoratePrompt(p, size, style) {
    const extras = [];
    if (style) extras.push(`风格：${style}`);
    if (size === 'portrait') extras.push(`画幅：竖版`);
    if (size === 'landscape') extras.push(`画幅：横版`);
    if (size === 'square') extras.push(`画幅：正方形`);
    extras.push('只返回生成的图像，不要任何文字描述。');
    return extras.length ? `${p}\n${extras.join('，')}` : p;
  }

  function showImages(urls) {
    resultContainer.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'nb-grid';

    urls.forEach(u => {
      const card = document.createElement('div');
      card.className = 'nb-card-img';

      const img = document.createElement('img');
      img.src = u;
      img.alt = '生成的图片';

      const bar = document.createElement('div');
      bar.className = 'nb-toolbar';

      const btnDL = mkBtn('下载', () => downloadDataUrl(u, `nano_${Date.now()}.png`));
      const btnShare = mkBtn('分享', async () => {
        try {
          if (navigator.share && navigator.canShare) {
            const file = await dataURLtoFile(u, 'image.png');
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'nano banana' });
              return;
            }
          }
          await navigator.clipboard.writeText(u);
          alert('已复制图片 DataURL，可自行分享');
        } catch (e) { alert('分享失败：' + (e?.message || e)); }
      });
      const btnRegen = mkBtn('基于此图再生成', async () => {
        selectedFiles = []; thumbnailsContainer.innerHTML = '';
        const f = await dataURLtoFile(u, `ref_${Date.now()}.png`);
        handleFiles([f]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      bar.append(btnDL, btnShare, btnRegen);
      card.append(img, bar);
      grid.append(card);
    });

    resultContainer.appendChild(grid);
  }

  function mkBtn(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = 'nb-btn';
    b.addEventListener('click', onClick);
    return b;
  }

  // ========== 历史记录 ==========
  async function appendHistory(fullImageUrls, prompt) {
    const key = 'nb_history';
    let old = [];
    try {
      old = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(old)) old = [];
    } catch { old = []; }

    try {
      const previews = await Promise.all(fullImageUrls.map(u => makePreviewDataURL(u, 320, 0.8)));
      const item = { ts: Date.now(), prompt, previews };
      const next = [item, ...old];
      safeSetHistoryArray(key, next, 30);
      renderHistory(next);
    } catch (err) {
      console.warn('生成历史预览失败', err);
      renderHistory(old);
    }
  }

  function loadHistory() {
    const key = 'nb_history';
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(arr)) renderHistory(arr);
      else renderHistory([]);
    } catch (e) {
      console.warn('读取历史失败，清空', e);
      try { localStorage.removeItem(key); } catch {}
      renderHistory([]);
    }
  }

  function renderHistory(arr) {
    historyContainer.replaceChildren();
    arr.forEach(entry => {
      const previews = Array.isArray(entry.previews) ? entry.previews : [];
      previews.forEach(u => {
        const img = document.createElement('img');
        img.src = u; img.alt = '历史图(预览)';
        img.title = new Date(entry.ts).toLocaleString();
        img.addEventListener('click', () => {
          showImages(entry.previews); // Show full versions if available or just the preview
        });
        historyContainer.appendChild(img);
      });
    });
  }

  // ===== 反馈 =====
  feedbackBtn.addEventListener('click', () => {
    feedbackText.value = '';
    if (typeof feedbackDialog.showModal === 'function') feedbackDialog.showModal();
    else alert('你的浏览器不支持原生对话框，请升级或换一个试试～');
  });
  feedbackCancel.addEventListener('click', () => feedbackDialog.close());
  feedbackSubmit?.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = feedbackText.value.trim();
    if (!text) return feedbackDialog.close();
    try {
      const resp = await fetch('/feedback', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ text })
      });
      const data = await resp.json();
      alert(data?.ok ? '感谢反馈！' : ('提交失败：' + (data?.error || '未知错误')));
    } catch (err) {
      alert('提交失败：' + (err?.message || String(err)));
    } finally {
      feedbackDialog.close();
    }
  });

  function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    btnText.textContent = isLoading ? '正在生成...' : '生成';
    spinner.classList.toggle('hidden', !isLoading);
  }
  function safeSetResultStatus(text) {
    resultContainer.innerHTML = `<p>${text}</p>`;
  }

  // ===== 工具函数 =====
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function fileToCompressedDataURL(file, maxW = 1280, maxH = 1280, quality = 0.9) {
    try {
        if (!file.type.startsWith('image/')) return await fileToBase64(file);
        const bitmap = await createImageBitmap(file);
        let { width, height } = bitmap;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        const w = Math.round(width * ratio);
        const h = Math.round(height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);

        const mime = file.type.includes('png') ? 'image/png' : 'image/jpeg';
        return canvas.toDataURL(mime, quality);
    } catch(e) {
        console.warn("Image compression failed, falling back to original:", e);
        return await fileToBase64(file);
    }
  }

  async function makePreviewDataURL(bigDataUrl, maxSide = 320, quality = 0.8) {
    const resp = await fetch(bigDataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    const { width, height } = bitmap;
    const ratio = Math.min(maxSide / Math.max(width, height), 1);
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);

    return canvas.toDataURL('image/jpeg', quality);
  }

  function safeSetHistoryArray(key, nextArray, maxItems = 30) {
    let arr = nextArray.slice(0, maxItems);
    while (arr.length > 0) {
      try {
        localStorage.setItem(key, JSON.stringify(arr));
        return true;
      } catch {
        arr.pop(); // 删除最旧的再试
      }
    }
    try { localStorage.removeItem(key); } catch {}
    return false;
  }

  async function dataURLtoFile(dataUrl, filename) {
    const r = await fetch(dataUrl);
    const blob = await r.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename; a.click();
  }
});
// --- END OF REPLACEMENT FILE: script.js ---