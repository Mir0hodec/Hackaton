/** Opt-in shared synthetic demo; never applies to workspace authentication. */
export function isLanDemo(settings: {
  LOCAL_DEMO_NETWORK?: string;
  DEMO_ONLY?: string;
  WORKSPACE_MODE?: string;
}) {
  return (
    settings.LOCAL_DEMO_NETWORK === 'true' &&
    settings.DEMO_ONLY === 'true' &&
    settings.WORKSPACE_MODE !== 'true'
  );
}
