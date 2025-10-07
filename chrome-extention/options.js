const els = {
    apiKey: document.getElementById('apiKey'),
    tone: document.getElementById('tone'),
    resume: document.getElementById('resume'),
    highlights: document.getElementById('highlights'),
    values: document.getElementById('values'),
    status: document.getElementById('status')
  };
  
  chrome.storage.sync.get(['apiKey','tone','profile'], ({ apiKey='', tone='concise', profile={} }) => {
    els.apiKey.value = apiKey;
    els.tone.value = tone;
    els.resume.value = profile.resume || '';
    els.highlights.value = profile.highlights || '';
    els.values.value = profile.values || '';
  });
  
  document.getElementById('save').onclick = async () => {
    await chrome.storage.sync.set({
      apiKey: els.apiKey.value.trim(),
      tone: els.tone.value,
      profile: {
        resume: els.resume.value.trim(),
        highlights: els.highlights.value.trim(),
        values: els.values.value.trim()
      }
    });
    els.status.textContent = 'Saved!';
    setTimeout(()=>els.status.textContent='',1500);
  };