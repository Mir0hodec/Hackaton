// Run under a service manager on an always-on host; do not paste its token into source.
const origin=process.env.NARYADAI_ORIGIN,token=process.env.REMINDER_TOKEN;
if(!origin?.startsWith('https://')||!token)throw new Error('Set NARYADAI_ORIGIN=https://your-app and REMINDER_TOKEN in the server environment');
async function tick(){try{const r=await fetch(new URL('/api/reminders',origin),{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});console.log(new Date().toISOString(),r.ok?'checked':'HTTP '+r.status);}catch{console.error(new Date().toISOString(),'reminder request failed');}}
await tick();setInterval(tick,30000);
