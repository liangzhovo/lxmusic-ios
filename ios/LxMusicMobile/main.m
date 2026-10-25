#import <UIKit/UIKit.h>
#import "AppDelegate.h"

#if TARGET_OS_SIMULATOR
#import "LXUITestOrientation.h"
#endif

static BOOL LXIsEditingText(UIView *view) {
  if (view.isFirstResponder && [view conformsToProtocol:@protocol(UITextInput)]) return YES;
  for (UIView *child in view.subviews) if (LXIsEditingText(child)) return YES;
  return NO;
}
@interface LXApplication : UIApplication
@end
@implementation LXApplication
- (NSArray<UIKeyCommand *> *)keyCommands {
  NSMutableArray *commands = [NSMutableArray arrayWithArray:[super keyCommands] ?: @[]];
  NSDictionary *settings = [[NSUserDefaults standardUserDefaults] dictionaryForKey:@"LXKeyboardShortcuts"] ?: @{};
  if (settings[@"enabled"] && ![settings[@"enabled"] boolValue]) return commands;
  for (UIScene *scene in self.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow && LXIsEditingText(window)) return commands;
  }
  NSArray *bindings = @[
    @[@" ", @0, @"toggle", @"播放/暂停", @"playback"],
    @[UIKeyInputLeftArrow, @(UIKeyModifierCommand), @"previous", @"上一曲", @"playback"],
    @[UIKeyInputRightArrow, @(UIKeyModifierCommand), @"next", @"下一曲", @"playback"],
    @[UIKeyInputLeftArrow, @0, @"seek_backward", @"快退5秒", @"seek"],
    @[UIKeyInputRightArrow, @0, @"seek_forward", @"快进5秒", @"seek"],
    @[UIKeyInputUpArrow, @0, @"select_up", @"选择上一条", @"selection"],
    @[UIKeyInputDownArrow, @0, @"select_down", @"选择下一条", @"selection"],
    @[@"\r", @0, @"select_enter", @"播放所选歌曲", @"selection"],
    @[@"l", @(UIKeyModifierCommand), @"locate_current", @"定位正在播放", @"selection"],
    @[@"1", @(UIKeyModifierCommand), @"nav_search", @"搜索", @"navigation"],
    @[@"2", @(UIKeyModifierCommand), @"nav_songlist", @"歌单", @"navigation"],
    @[@"3", @(UIKeyModifierCommand), @"nav_top", @"排行榜", @"navigation"],
    @[@"4", @(UIKeyModifierCommand), @"nav_love", @"我的列表", @"navigation"],
    @[@"5", @(UIKeyModifierCommand), @"nav_setting", @"设置", @"navigation"],
    @[@",", @(UIKeyModifierCommand), @"nav_setting", @"设置", @"navigation"],
    @[UIKeyInputEscape, @0, @"escape", @"关闭当前菜单", @"navigation"]
  ];
  for (NSArray *binding in bindings) {
    if (settings[binding[4]] && ![settings[binding[4]] boolValue]) continue;
    UIKeyCommand *key = [UIKeyCommand commandWithTitle:binding[3] image:nil action:@selector(lx_keyboard:) input:binding[0] modifierFlags:[binding[1] unsignedIntegerValue] propertyList:binding[2]];
    key.discoverabilityTitle = binding[3];
    if (@available(iOS 15.0, *)) key.wantsPriorityOverSystemBehavior = YES;
    [commands addObject:key];
  }
  return commands;
}
- (void)lx_keyboard:(UIKeyCommand *)key {
  // Re-check editing state on delivery: focus may have changed since keyCommands.
  for (UIScene *scene in self.connectedScenes) if ([scene isKindOfClass:UIWindowScene.class])
    for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow && LXIsEditingText(window)) return;
  if (![key.propertyList isKindOfClass:NSString.class]) return;
  [[NSNotificationCenter defaultCenter] postNotificationName:@"LXRemoteCommand" object:nil userInfo:@{ @"command": key.propertyList, @"source": @"keyboard" }];
}
@end
int main(int argc, char *argv[]) {
  @autoreleasepool { return UIApplicationMain(argc, argv, NSStringFromClass(LXApplication.class), NSStringFromClass(AppDelegate.class)); }
}
