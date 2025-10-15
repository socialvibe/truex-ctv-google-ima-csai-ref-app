import { InteractiveAd } from "../components/interactive-ad";
import uuid from 'uuid';

/**
 * Minimal Bitmovin controller with built-in IMA advertising support
 */
export class BitmovinController {
    constructor(videoOwner, controlBarSelector, platform) {
        this.videoOwner = document.querySelector(videoOwner);
        if (!this.videoOwner) {
            throw new Error('video owner not found: ' + videoOwner);
        }

        this.currentUserId = uuid.v4();
        this.player = null;
        this.videoStream = null;
        this.imaAdsManager = null;
    }

    startVideoLater(videoStream, showControlBar) {
        setTimeout(() => this.startVideo(videoStream, showControlBar), 1);
    }

    startVideo(videoStream, showControlBar) {
        if (this.player) {
            this.stopVideo();
        }

        this.videoStream = videoStream;
        // Ensure videoStream has an id for macro substitution
        if (!this.videoStream.id) {
            this.videoStream.id = uuid.v4();
        }
        console.log(`starting video: ${videoStream.title}`);

        // Create player container
        const video = document.createElement('div');
        video.id = 'bitmovin-player';
        const firstOverlayChild = this.videoOwner.firstChild;
        this.videoOwner.insertBefore(video, firstOverlayChild);

        // Configure Bitmovin player with built-in IMA
        const config = {
            key: '6108af96-cc35-44b1-82bc-86ed6c1aa1c1',
            ui: false,
            playback: {
                autoplay: true,
                muted: false
            },
            advertising: {
                adBreaks: [
                    {
                        position: 'pre',
                        tag: {
                            type: 'vast',
                            url: 'https://s3.us-east-1.amazonaws.com/stash.truex.com/sample-tags/csai-html5/sample-ad-playlist.xml'
                        }
                    }
                ],
                onAdsManagerAvailable: (imaAdsManager) => {
                    this.imaAdsManager = imaAdsManager;
                }
            }
        };

        // Initialize player
        this.player = new bitmovin.player.Player(video, config);

        // Load video source
        const hlsUrl = 'https://cdn.bitmovin.com/content/assets/art-of-motion-dash-hls-progressive/m3u8s/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8';

        this.player.load({
            hls: hlsUrl,
            title: videoStream.title || 'Demo Video',
            poster: videoStream.cover
        }).then(() => {
            console.log('Video source loaded successfully');
            this.setupEventListeners();
        }).catch((error) => {
            console.error('Error loading video source:', error);
        });
    }

    setupEventListeners() {
        // Listen to Bitmovin ad events
        this.player.on(bitmovin.player.PlayerEvent.AdStarted, (event) => {
            console.log('Ad started:', event);
            this.onAdStarted(event);
        });

        this.player.on(bitmovin.player.PlayerEvent.AdFinished, (event) => {
            console.log('Ad finished:', event);
        });

        this.player.on(bitmovin.player.PlayerEvent.AdError, (event) => {
            console.error('Ad error:', event);
        });

        this.player.on(bitmovin.player.PlayerEvent.Playing, () => {
            console.log('Video playing');
        });
    }

    onAdStarted(event) {
        const adData = event.ad.data;
        const adSystem = adData?.adSystem?.name || '';

        console.log(`Ad detected: system=${adSystem}`);

        const isIDVxAd = adSystem === 'IDVx';
        const isTruexAd = adSystem === 'trueX';

        if (isTruexAd || isIDVxAd) {
            console.log(`Interactive ad detected: trueX=${isTruexAd}, IDVx=${isIDVxAd}`);
            this.startInteractiveAd(event.ad, isTruexAd, isIDVxAd);
        }
    }

    startInteractiveAd(ad, isTruexAd, isIDVxAd) {
        const adData = ad.data;

        // Get VAST config URL from ad description (for trueX)
        let vastConfigUrl = adData?.adDescription?.trim() || '';
        if (vastConfigUrl) {
            if (!vastConfigUrl.startsWith('http')) {
                vastConfigUrl = 'https://' + vastConfigUrl;
            }

            vastConfigUrl = vastConfigUrl.replace('#{stream-id}', this.videoStream.id);
            vastConfigUrl = vastConfigUrl.replace('#{user-id}', this.currentUserId);
        }

        // Get VAST config from AdParameters (for IDVx)
        // Access IMA SDK directly since Bitmovin's wrapper doesn't expose AdParameters
        let vastConfigJson = null;
        if (this.imaAdsManager.getCurrentAd) {
            const imaAd = this.imaAdsManager.getCurrentAd();
            if (imaAd && imaAd.getTraffickingParametersString) {
                let rawParameters = imaAd.getTraffickingParametersString().trim();
                console.log('Got AdParameters via IMA SDK:', rawParameters ? 'YES' : 'NO');
                
                vastConfigJson = rawParameters ? JSON.parse(rawParameters) : null;
            }
        }

        if (!vastConfigUrl && !vastConfigJson) {
            console.log('No VAST config found, treating as regular ad');
            return;
        }

        console.log(`Starting interactive ad experience: trueX=${isTruexAd}, IDVx=${isIDVxAd}`);

        // Hide the player and pause
        this.showPlayer(false);
        this.player.pause();

        // Skip the placeholder ad video to its end, so if user declines TrueX,
        // playback resumes from the end (effectively skipping the placeholder)
        const allVideos = this.videoOwner.querySelectorAll('video');
        const adVideo = Array.from(allVideos).find(v => !v.paused);
        if (!adVideo) {
            console.log('No video element found, treating as regular ad');
            return;
        }

        const adDuration = this.imaAdsManager.getCurrentAd().getDuration();
        if (!adDuration || adDuration <= 0) {
            console.log('No ad duration found, treating as regular ad');
            return;
        }
        
        adVideo.currentTime = adDuration;

        // Create and start the interactive ad
        const interactiveAd = new InteractiveAd(vastConfigJson || vastConfigUrl, this);
        interactiveAd.start();
    }

    skipAdBreak() {
        console.log('Skipping ad break after TrueX engagement');

        try {
            this.imaAdsManager.discardAdBreak();
            console.log('Ad break discarded via IMA SDK');
        } catch (e) {
            console.warn('Could not discard ad break:', e);
        }

        this.showPlayer(true);
        this.player.play();
    }

    resumeAdPlayback() {
        console.log('Resuming ad playback after TrueX decline');

        this.showPlayer(true);
        this.player.play();
    }

    stopVideo() {
        if (!this.player) return;

        this.player.destroy();
        this.player = null;

        const playerContainer = this.videoOwner.querySelector('#bitmovin-player');
        if (playerContainer && playerContainer.parentNode) {
            playerContainer.parentNode.removeChild(playerContainer);
        }
    }

    showPlayer(visible) {
        if (visible) {
            this.videoOwner.classList.add('show');
        } else {
            this.videoOwner.classList.remove('show');
        }
    }

    showLoadingSpinner(visible) {
        // Stub for now - could implement loading spinner later
        console.log('showLoadingSpinner:', visible);
    }
}
