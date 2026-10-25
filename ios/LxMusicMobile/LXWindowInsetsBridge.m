#import <React/RCTViewManager.h>

@interface RCT_EXTERN_REMAP_MODULE(LXWindowInsets, LXWindowInsetsManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(onInsetsChange, RCTDirectEventBlock)
@end

@interface RCT_EXTERN_MODULE(LXWindowAppearance, NSObject)
RCT_EXTERN_METHOD(setDark:(BOOL)dark)
RCT_EXTERN_METHOD(setAuto)
RCT_EXTERN_METHOD(getSystemDark:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
