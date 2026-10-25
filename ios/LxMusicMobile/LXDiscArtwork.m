// Native rendering of Any Listen's CoverCD geometry. Reference and license:
// docs/BUILD88_UI_REWORK.md. Album art remains the current track's own image.
#import <UIKit/UIKit.h>
#import <React/RCTBridge.h>
#import <React/RCTConvert.h>
#import <React/RCTImageLoader.h>
#import <React/RCTViewManager.h>

@interface LXDiscArtworkView : UIView
@property(nonatomic, copy) NSDictionary *source;
@property(nonatomic, strong) UIColor *discColor;
@property(nonatomic, strong) UIColor *hubColor;
@property(nonatomic, strong) UIColor *ringColor;
- (instancetype)initWithBridge:(RCTBridge *)bridge;
@end

@implementation LXDiscArtworkView {
  __weak RCTBridge *_bridge;
  UIImage *_artwork;
  RCTImageLoaderCancellationBlock _cancelImage;
  NSUInteger _generation;
}
- (instancetype)initWithBridge:(RCTBridge *)bridge {
  if ((self = [super initWithFrame:CGRectZero])) {
    _bridge = bridge; self.opaque = NO; self.backgroundColor = UIColor.clearColor;
    self.contentMode = UIViewContentModeRedraw;
  }
  return self;
}
- (void)dealloc { if (_cancelImage) _cancelImage(); }
- (void)setSource:(NSDictionary *)source {
  if ([_source isEqualToDictionary:source]) return;
  _source = [source copy]; _generation++; NSUInteger generation = _generation;
  if (_cancelImage) { _cancelImage(); _cancelImage = nil; }
  _artwork = nil; [self setNeedsDisplay];
  NSURLRequest *request = [RCTConvert NSURLRequest:source];
  if (!request.URL) return;
  __weak LXDiscArtworkView *weakSelf = self;
  RCTImageLoader *loader = [_bridge moduleForClass:[RCTImageLoader class]];
  _cancelImage = [loader loadImageWithURLRequest:request size:CGSizeMake(1024, 1024) scale:1
    clipped:NO resizeMode:RCTResizeModeContain progressBlock:nil partialLoadBlock:nil
    completionBlock:^(NSError *error, UIImage *image) {
      dispatch_async(dispatch_get_main_queue(), ^{
        LXDiscArtworkView *view = weakSelf;
        if (!view || view->_generation != generation) return;
        view->_artwork = error ? nil : image; [view setNeedsDisplay];
      });
    }];
}
- (void)setDiscColor:(UIColor *)value { _discColor = value; [self setNeedsDisplay]; }
- (void)setHubColor:(UIColor *)value { _hubColor = value; [self setNeedsDisplay]; }
- (void)setRingColor:(UIColor *)value { _ringColor = value; [self setNeedsDisplay]; }
- (void)drawRect:(CGRect)rect {
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) return;
  CGContextRef c = UIGraphicsGetCurrentContext();
  CGContextScaleCTM(c, self.bounds.size.width / 100.0, self.bounds.size.height / 100.0);
  CGContextSaveGState(c);
  // SVG mask: outer radius 50, transparent centre radius 11.6.
  CGContextAddEllipseInRect(c, CGRectMake(0, 0, 100, 100));
  CGContextAddEllipseInRect(c, CGRectMake(38.4, 38.4, 23.2, 23.2));
  CGContextEOClip(c);
  [(_discColor ?: UIColor.lightGrayColor) setFill]; CGContextFillRect(c, CGRectMake(0, 0, 100, 100));
  CGContextSaveGState(c);
  CGContextAddEllipseInRect(c, CGRectMake(2, 2, 96, 96)); CGContextClip(c);
  if (_artwork && _artwork.size.width > 0 && _artwork.size.height > 0) {
    CGFloat scale = MAX(96 / _artwork.size.width, 96 / _artwork.size.height);
    CGSize size = CGSizeMake(_artwork.size.width * scale, _artwork.size.height * scale);
    [_artwork drawInRect:CGRectMake(50-size.width/2, 50-size.height/2, size.width, size.height)
              blendMode:kCGBlendModeMultiply alpha:1];
  }
  CGContextRestoreGState(c);
  CGContextSetBlendMode(c, kCGBlendModeMultiply);
  [(_hubColor ?: UIColor.clearColor) setFill];
  CGContextFillEllipseInRect(c, CGRectMake(30, 30, 40, 40));
  CGContextRestoreGState(c);
  // The inner exclusion ring is outside the mask, as in the source SVG.
  CGContextSaveGState(c);
  CGContextSetBlendMode(c, kCGBlendModeExclusion);
  CGContextSetShadowWithColor(c, CGSizeZero, 1, [UIColor colorWithWhite:0 alpha:.5].CGColor);
  [(_ringColor ?: UIColor.grayColor) setStroke]; CGContextSetLineWidth(c, 1.2);
  CGContextStrokeEllipseInRect(c, CGRectMake(39, 39, 22, 22));
  CGContextRestoreGState(c);
  [(_ringColor ?: UIColor.grayColor) setStroke]; CGContextSetLineWidth(c, .4);
  CGContextStrokeEllipseInRect(c, CGRectMake(38.4, 38.4, 23.2, 23.2));
}
@end

@interface LXDiscArtworkManager : RCTViewManager @end
@implementation LXDiscArtworkManager
RCT_EXPORT_MODULE(LXDiscArtwork)
- (UIView *)view { return [[LXDiscArtworkView alloc] initWithBridge:self.bridge]; }
RCT_EXPORT_VIEW_PROPERTY(source, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(discColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(hubColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(ringColor, UIColor)
@end

@interface LXDiscMountView : UIView
@property(nonatomic, strong) UIColor *fillColor;
@property(nonatomic, strong) UIColor *shadeColor;
@end
@implementation LXDiscMountView
- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) { self.opaque = NO; self.backgroundColor = UIColor.clearColor; self.contentMode = UIViewContentModeRedraw; }
  return self;
}
- (void)setFillColor:(UIColor *)value { _fillColor = value; [self setNeedsDisplay]; }
- (void)setShadeColor:(UIColor *)value { _shadeColor = value; [self setNeedsDisplay]; }
- (void)drawRect:(CGRect)rect {
  CGContextRef c = UIGraphicsGetCurrentContext(); CGRect bounds = self.bounds;
  CGContextAddEllipseInRect(c, bounds); CGContextClip(c);
  [(_fillColor ?: UIColor.clearColor) setFill]; CGContextFillRect(c, bounds);
  CGContextSetShadowWithColor(c, CGSizeZero, 4, (_shadeColor ?: UIColor.grayColor).CGColor);
  CGContextAddRect(c, CGRectInset(bounds, -8, -8)); CGContextAddEllipseInRect(c, bounds);
  [(_shadeColor ?: UIColor.grayColor) setFill]; CGContextEOFillPath(c);
}
@end
@interface LXDiscMountManager : RCTViewManager @end
@implementation LXDiscMountManager
RCT_EXPORT_MODULE(LXDiscMount)
- (UIView *)view { return [LXDiscMountView new]; }
RCT_EXPORT_VIEW_PROPERTY(fillColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(shadeColor, UIColor)
@end
