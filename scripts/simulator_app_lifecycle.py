"""Track launch attempts only for simulators created by the current test run.

A newly created simulator cannot already be running our application. Avoid
asking CoreSimulator to terminate a nonexistent process before its first
launch; subsequent launches still terminate and all command failures propagate.
"""


class OwnedSimulatorApps:
    def __init__(self, simctl, bundle):
        self._simctl = simctl
        self._bundle = bundle
        self._attempted = {}

    def register(self, simulator):
        if not simulator or simulator in self._attempted:
            raise ValueError('Expected a new simulator owned by this run')
        self._attempted[simulator] = False

    def before_launch(self, simulator):
        if simulator not in self._attempted:
            raise ValueError('Refusing to manage an unowned simulator')
        if self._attempted[simulator]:
            # check=False permits the existing "nothing to terminate" result,
            # not timeouts: both drivers propagate command timeout exceptions.
            self._simctl('terminate', simulator, self._bundle, check=False)
        # Mark the attempt before launching: an uncertain failed launch must
        # still be terminated before a later phase can start in a clean process.
        self._attempted[simulator] = True
