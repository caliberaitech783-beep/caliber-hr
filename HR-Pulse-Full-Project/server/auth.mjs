export async function authenticate(grant) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(grant || '')) return null;
  let response;
  try {
    response = await fetch('https://pulse.cmll.in/api/integrations/hr/validate', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({grant}),
      redirect:'error', signal:AbortSignal.timeout(10000),
    });
  } catch { throw Object.assign(new Error('Pulse authentication is temporarily unavailable'),{status:503}); }
  if (!response.ok) {
    if (response.status>=500) throw Object.assign(new Error('Pulse authentication is temporarily unavailable'),{status:503});
    return null;
  }
  const result = await response.json();
  const profile = result.profile;
  if (profile?.permissions?.application !== 'HR') return null;
  const identity = profile.login || profile.username || profile.email || profile.userId || profile.id;
  if (!identity || typeof identity!=='string'&&typeof identity!=='number') throw Object.assign(new Error('Pulse did not return a stable user identity'),{status:403});
  return { ...profile, actor:String(identity).toLowerCase() };
}
