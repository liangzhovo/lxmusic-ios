#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate
@property(nonatomic, copy) NSDictionary *lxLaunchOptions;
- (void)startReactNativeWithLaunchOptions:(NSDictionary *)launchOptions;

@end
