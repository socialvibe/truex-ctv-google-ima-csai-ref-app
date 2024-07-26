import uuid from 'uuid';
import { TruexAdRenderer } from '@truex/ad-renderer';

// Exercises the True[X] Ad Renderer for interactive ads.
// NOTE: this is the main integration point for display interactive ads via the true[X] SDK.
export class InteractiveAd {
    constructor(vastConfigUrl, videoController) {
        let adFreePod = false;
        let adOverlay;
        let tar;

        this.start = () => {
            try {
                const options = {
                    supportsUserCancelStream: true // i.e. user backing out of an ad will cancel the entire video
                };

                tar = new TruexAdRenderer(vastConfigUrl, options);
                tar.subscribe(handleAdEvent);

                return tar.init()
                    .then(vastConfig => {
                        return tar.start(vastConfig);
                    })
                    .then(newAdOverlay => {
                        adOverlay = newAdOverlay;
                    })
                    .catch(handleAdError);
            } catch (err) {
                handleAdError(err);
            }
        };

        function handleAdEvent(event) {
            const adEvents = tar.adEvents;
            switch (event.type) {
                case adEvents.adError:
                    handleAdError(event.errorMessage);
                    break;

                case adEvents.adStarted:
                    // Choice card loaded and displayed.
                    videoController.showLoadingSpinner(false);
                    break;

                case adEvents.optIn:
                    // User started the engagement experience
                    break;

                case adEvents.optOut:
                    // User cancelled out of the choice card, either explicitly, or implicitly via a timeout.
                    break;

                case adEvents.adFreePod:
                    adFreePod = true; // the user did sufficient interaction for an ad credit
                    break;

                case adEvents.userCancel:
                    // User backed out of the ad, now showing the choice card again.
                    break;

                case adEvents.userCancelStream:
                    // User backed out of the choice card, which means backing out of the entire video.
                    closeAdOverlay();
                    videoController.closeVideoAction();
                    break;

                case adEvents.noAdsAvailable:
                case adEvents.adCompleted:
                    // Ad is not available, or has completed. Depending on the adFreePod flag, either the main
                    // video or the ad fallback videos are resumed.
                    closeAdOverlay();
                    resumePlayback();
                    break;
            }
        }

        function handleAdError(errOrMsg) {
            console.error('ad error: ' + errOrMsg);
            if (tar) {
                // Ensure the ad is no longer blocking back or key events, etc.
                tar.stop();
            }
            closeAdOverlay();
            resumePlayback();
        }

        function closeAdOverlay() {
            // The client-side IMA SDK can steal the keyboard focus, esp if the user is clicking on ads.
            // Ensure the app focus is again in place.
            window.focus();

            videoController.showLoadingSpinner(false);
            if (adOverlay) {
                if (adOverlay.parentNode) adOverlay.parentNode.removeChild(adOverlay);
                adOverlay = null;
            }
            videoController.showPlayer(true);
        }

        function resumePlayback() {
            if (adFreePod) {
                // The user has the ad credit, skip over the ad video.
                videoController.skipAdBreak();
            } else {
                videoController.resumeAdPlayback();
            }
        }
    }
}
