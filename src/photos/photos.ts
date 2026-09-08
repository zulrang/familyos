export type Photo = { id: string; src: string };
export type PhotosStatus =
  | { state: "unconfigured" }
  | { state: "disconnected" }
  | { state: "selecting"; pickerUrl: string; pollAfterMs: number }
  | {
      state: "ready";
      pickerUrl: string;
      sourceName: string;
      photos: Photo[];
      pollAfterMs: number;
    };
export type PickerPhoto = { id: string; baseUrl: string };
export type PhotosConnection =
  | { state: "disconnected" }
  | {
      state: "selecting";
      sessionId: string;
      pickerUrl: string;
      nextPollAt: number;
      expiresAt: number;
      pollAfterMs: number;
    }
  | {
      state: "ready";
      sessionId: string;
      pickerUrl: string;
      nextPollAt: number;
      expiresAt: number;
      photos: PickerPhoto[];
      nextMediaPollAt: number;
      mediaExpiresAt: number;
    };
