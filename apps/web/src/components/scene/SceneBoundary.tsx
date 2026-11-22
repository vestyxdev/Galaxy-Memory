import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last-resort boundary for the WebGL canvas — if R3F/three throws during
 * mount (no WebGL, GPU blocklist), the shell stays usable instead of a
 * blank page.
 */
export class SceneBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="max-w-xs text-center text-sm leading-relaxed text-white/40">
            The 3D view couldn’t start - this browser may not support WebGL. Your memories are still
            safe in Pages.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
