/**
 * @module game/civ5-executable
 *
 * Which Civilization V binary Vox Deorum launches and tracks. A Steam install
 * ships a DirectX 11 build next to the default one, and the `useDX11` setting
 * picks between them. The launch script falls back to the default binary when
 * the DirectX 11 one is missing, so callers that watch for the process should
 * be ready to see either image name.
 */

/** Image name of the DirectX 11 Civilization V build. */
export const civ5ExecutableDX11 = 'CivilizationV_DX11.exe';

/** Image name of the default Civilization V build, present in every install. */
export const civ5ExecutableDefault = 'CivilizationV.exe';

/**
 * Pick the executable image name for a `useDX11` setting.
 * Unset means DirectX 11, matching the shipped default.
 */
export function resolveCiv5Executable(useDX11?: boolean): string {
  return useDX11 === false ? civ5ExecutableDefault : civ5ExecutableDX11;
}

/**
 * Image names a launched game can appear under, preferred build first.
 * The default binary is included as a second candidate whenever DirectX 11 is
 * requested, because the launch script falls back to it on installs that lack
 * the DirectX 11 build.
 */
export function civ5ExecutableCandidates(useDX11?: boolean): string[] {
  const preferred = resolveCiv5Executable(useDX11);
  return preferred === civ5ExecutableDefault ? [preferred] : [preferred, civ5ExecutableDefault];
}
