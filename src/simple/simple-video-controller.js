import { BaseVideoController } from '../components/video-controller';

/**
 * Presents a video controller that demonstrates the "simple" use of the client-side ad insertion IMA SDK
 * I.e. we implement the video player ourselves, the idea being that approach should be generalizable to any player.
 */
export class SimpleVideoController extends BaseVideoController {
    constructor(videoOwner, controlBarSelector, platform) {
        super(videoOwner, controlBarSelector, platform);
    }
}
