export const state = {
    user: null,
    channelId: null,
    isHost: false,
    ws: null,
    hls: null,
    currentVideo: null,
    isSeeking: false,
    captionsEnabled: false,
    currentSubtitle: null,
    provider: 'animekai',
    isDub: false, // Sub/Dub toggle
    lastSyncTime: 0, // For late joiner sync
    episodeList: [], // For auto-next
    roomSettings: { freeMode: false },
};
