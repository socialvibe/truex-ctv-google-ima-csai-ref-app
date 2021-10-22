import { BaseVideoController } from '../components/video-controller';

/**
 * Presents a video controller that demonstrates the client-side ad insertion IMA SDK
 * in conjunction with the VideoJS video player and plugins, which manages the video player
 * / ad player switching out of the box.
 */
export class VideoJSController extends BaseVideoController {
    constructor(videoOwner, controlBarSelector, platform) {
        super(videoOwner, controlBarSelector, platform);
    }
}
