// Load saved API URL on open
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ action: 'getApiUrl' }, (response) => {
    if (response && response.url) {
      document.getElementById('apiUrl').value = response.url;
    }
  });
});

// Save API URL
document.getElementById('saveApiBtn').addEventListener('click', () => {
  const url = document.getElementById('apiUrl').value.trim();
  if (!url) {
    showStatus('apiStatus', 'Please enter a URL (http:// or https://)', 'error');
    return;
  }
  try { new URL(url); } catch(e) {
    showStatus('apiStatus', 'Invalid URL format', 'error');
    return;
  }
  
  const btn = document.getElementById('saveApiBtn');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  
  chrome.runtime.sendMessage({ action: 'setApiUrl', url }, (response) => {
    btn.textContent = '💾 Save';
    btn.disabled = false;
    if (response?.success) {
      showStatus('apiStatus', '✅ API URL saved. Now visit your backend site to auto‑capture token.', 'success');
    } else {
      showStatus('apiStatus', '❌ Failed to save', 'error');
    }
  });
});

// Index current page
document.getElementById('indexBtn').addEventListener('click', () => {
  const btn = document.getElementById('indexBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Indexing...';
  btn.disabled = true;
  showStatus('indexStatus', 'Processing...', 'info');
  
  chrome.runtime.sendMessage({ action: 'indexPage' }, (response) => {
    btn.textContent = originalText;
    btn.disabled = false;
    if (response?.success) {
      showStatus('indexStatus', '✅ Page indexed successfully!', 'success');
    } else {
      showStatus('indexStatus', '❌ Error: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
});

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    el.innerHTML = '';
    
    const statusDiv = document.createElement('div');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    el.appendChild(statusDiv);
    
    setTimeout(() => {
        if (el.firstChild === statusDiv) {
            el.removeChild(statusDiv);
        }
    }, 3000);
}