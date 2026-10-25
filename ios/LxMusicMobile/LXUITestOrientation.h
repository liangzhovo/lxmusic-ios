// Compiled ONLY into simulator test builds by main.m. Uses public scene geometry
// requests, never fake Dimensions values or rendered-image rotation.
#import <React/RCTBridgeModule.h>

@interface LXUITestOrientation : NSObject <RCTBridgeModule>
@end
@implementation LXUITestOrientation
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
RCT_REMAP_METHOD(setOrientation, setOrientation:(NSString *)orientation
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![NSProcessInfo.processInfo.arguments containsObject:@"--lx-playback-smoke"]) {
      reject(@"test_only", @"Orientation control is restricted to simulator tests", nil); return;
    }
    if (@available(iOS 16.0, *)) {
      UIWindow *window = ((AppDelegate *)UIApplication.sharedApplication.delegate).window;
      UIWindowScene *scene = window.windowScene;
      UIViewController *root = window.rootViewController;
      if (!scene || !root) { reject(@"scene_missing", @"No active scene-owned root", nil); return; }
      BOOL landscape = [orientation isEqualToString:@"landscape"];
      UIInterfaceOrientationMask mask = landscape ? UIInterfaceOrientationMaskLandscapeRight : UIInterfaceOrientationMaskPortrait;
      NSMutableArray<UIViewController *> *pending = [NSMutableArray arrayWithObject:root];
      while (pending.count) {
        UIViewController *controller = pending.lastObject;
        [pending removeLastObject];
        [controller setNeedsUpdateOfSupportedInterfaceOrientations];
        [pending addObjectsFromArray:controller.childViewControllers];
        if (controller.presentedViewController) [pending addObject:controller.presentedViewController];
      }
      __block BOOL settled = NO;
      __block void (^poll)(NSInteger) = nil;
      poll = ^(NSInteger attempt) {
        if (settled) { poll = nil; return; }
        BOOL actualLandscape = UIInterfaceOrientationIsLandscape(scene.interfaceOrientation);
        BOOL boundsLandscape = window.bounds.size.width > window.bounds.size.height;
        if (actualLandscape == landscape && boundsLandscape == landscape) {
          settled = YES;
          resolve(@{ @"requested": orientation, @"actual": @(scene.interfaceOrientation),
                     @"width": @(window.bounds.size.width), @"height": @(window.bounds.size.height),
                     @"rootClass": NSStringFromClass(root.class), @"supportedMask": @(root.supportedInterfaceOrientations) });
          poll = nil; return;
        }
        if (attempt >= 80) {
          settled = YES;
          NSString *detail = [NSString stringWithFormat:@"Scene did not reach %@: orientation=%ld bounds=%@ root=%@ supported=%lu",
                             orientation, (long)scene.interfaceOrientation, NSStringFromCGRect(window.bounds),
                             NSStringFromClass(root.class), (unsigned long)root.supportedInterfaceOrientations];
          reject(@"orientation_timeout", detail, nil); poll = nil; return;
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ if (poll) poll(attempt + 1); });
      };
      UIWindowSceneGeometryPreferencesIOS *preferences = [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
      [scene requestGeometryUpdateWithPreferences:preferences errorHandler:^(NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (settled) return;
          settled = YES; poll = nil;
          reject(@"orientation_request", error.localizedDescription, error);
        });
      }];
      poll(0);
    } else { reject(@"sdk_unavailable", @"Scene geometry test requires iOS 16 or newer", nil); }
  });
}
@end
