#include "Environment.hpp"

namespace reactnativecss {
    namespace env {

        static std::shared_ptr<reactnativecss::Observable<double>> &widthRef() {
            static auto inst = reactnativecss::Observable<double>::create(0.0);
            return inst;
        }

        static std::shared_ptr<reactnativecss::Observable<double>> &heightRef() {
            static auto inst = reactnativecss::Observable<double>::create(0.0);
            return inst;
        }

        static std::shared_ptr<reactnativecss::Observable<double>> &scaleRef() {
            static auto inst = reactnativecss::Observable<double>::create(0.0);
            return inst;
        }

        static std::shared_ptr<reactnativecss::Observable<double>> &fontScaleRef() {
            static auto inst = reactnativecss::Observable<double>::create(0.0);
            return inst;
        }

        static std::shared_ptr<reactnativecss::Observable<std::string>> &platformRef() {
            static auto inst = reactnativecss::Observable<std::string>::create("");
            return inst;
        }

        static std::shared_ptr<reactnativecss::Observable<std::string>> &colorSchemeRef() {
            static auto inst = reactnativecss::Observable<std::string>::create("");
            return inst;
        }

        reactnativecss::Observable<double> &windowWidth() { return *widthRef(); }

        reactnativecss::Observable<double> &windowHeight() { return *heightRef(); }

        reactnativecss::Observable<double> &windowScale() { return *scaleRef(); }

        reactnativecss::Observable<double> &windowFontScale() { return *fontScaleRef(); }

        reactnativecss::Observable<std::string> &platform() { return *platformRef(); }

        reactnativecss::Observable<std::string> &colorScheme() { return *colorSchemeRef(); }

        void setWindowDimensions(double width, double height, double scale, double fontScale) {
            widthRef()->set(width);
            heightRef()->set(height);
            scaleRef()->set(scale);
            fontScaleRef()->set(fontScale);
        }

        void setPlatform(const std::string &platform) {
            platformRef()->set(platform);
        }

        void setColorScheme(const std::string &colorScheme) {
            colorSchemeRef()->set(colorScheme);
        }

    } // namespace env
} // namespace reactnativecss

