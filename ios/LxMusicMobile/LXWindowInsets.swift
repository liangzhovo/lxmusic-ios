import UIKit
import React

// Measure only this root's uncovered safe region. Ancestor bars are already
// reflected by UIKit. LXSceneDelegate requests the minimal window-control style.
@objc(LXWindowInsetsView)
final class LXWindowInsetsView: UIView {
  @objc var onInsetsChange: RCTDirectEventBlock? { didSet { scheduleInsets() } }
  private var lastTop: CGFloat = -1
  private var lastBottom: CGFloat = -1
  private var scheduled = false

  override func layoutSubviews() { super.layoutSubviews(); scheduleInsets() }
  override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); scheduleInsets() }
  override func didMoveToWindow() { super.didMoveToWindow(); scheduleInsets() }

  private func scheduleInsets() {
    guard !scheduled else { return }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.scheduled = false
      guard self.window != nil, let emit = self.onInsetsChange else { return }
      var insets = self.safeAreaInsets
      if #available(iOS 26.0, *) {
        insets = self.edgeInsets(for: .safeArea(cornerAdaptation: .vertical))
      }
      let top = max(0, insets.top)
      let bottom = max(0, insets.bottom)
      guard abs(top - self.lastTop) > 0.1 || abs(bottom - self.lastBottom) > 0.1 else { return }
      self.lastTop = top
      self.lastBottom = bottom
      emit(["top": top, "bottom": bottom])
    }
  }
}

@objc(LXWindowInsetsManager)
final class LXWindowInsetsManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { return true }
  override func view() -> UIView! {
    let view = LXWindowInsetsView()
    view.backgroundColor = .clear
    view.isUserInteractionEnabled = false
    view.isAccessibilityElement = false
    return view
  }
}

// UIKit modal controllers use the window's traits when their own status-bar
// preference is automatic. RNN controllers are updated by Navigation.mergeOptions.
@objc(LXWindowAppearance)
final class LXWindowAppearance: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }
  @objc func setDark(_ dark: Bool) {
    DispatchQueue.main.async {
      for scene in UIApplication.shared.connectedScenes {
        guard let scene = scene as? UIWindowScene else { continue }
        for window in scene.windows {
          window.overrideUserInterfaceStyle = dark ? .dark : .light
          self.refresh(window.rootViewController)
        }
      }
    }
  }
  @objc func setAuto() {
    DispatchQueue.main.async {
      for scene in UIApplication.shared.connectedScenes {
        guard let scene = scene as? UIWindowScene else { continue }
        for window in scene.windows {
          window.overrideUserInterfaceStyle = .unspecified
          self.refresh(window.rootViewController)
        }
      }
    }
  }
  @objc(getSystemDark:rejecter:)
  func getSystemDark(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
      let style = scene?.traitCollection.userInterfaceStyle ?? UIScreen.main.traitCollection.userInterfaceStyle
      resolve(style == .dark)
    }
  }
  private func refresh(_ controller: UIViewController?) {
    guard let controller = controller else { return }
    controller.setNeedsStatusBarAppearanceUpdate()
    for child in controller.children { refresh(child) }
    refresh(controller.presentedViewController)
  }
}
