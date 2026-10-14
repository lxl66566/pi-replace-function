/**
 * pi extension entry point. Load with `pi --extension ./src/index.ts`, from
 * the user/project extensions directory, or via the `pi.extensions` field in
 * package.json.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { replaceFunctionTool } from './tool.ts';

export default function replaceFunctionExtension(pi: ExtensionAPI): void {
  pi.registerTool(replaceFunctionTool);
}
