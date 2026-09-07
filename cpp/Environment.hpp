#pragma once

#include <string>

#include "Observable.hpp"

namespace reactnativecss {
    namespace env {

// Accessors to global environment observables. These are lightweight and
// can be used with Effect::GetProxy for reactive reads from anywhere.

        reactnativecss::Observable<double> &windowWidth();

        reactnativecss::Observable<double> &windowHeight();

        reactnativecss::Observable<double> &windowScale();

        reactnativecss::Observable<double> &windowFontScale();

        reactnativecss::Observable<std::string> &platform();

        reactnativecss::Observable<std::string> &colorScheme();

// Convenience API to update all four metrics in one shot.
        void setWindowDimensions(double width, double height, double scale, double fontScale);

        void setPlatform(const std::string &platform);

        void setColorScheme(const std::string &colorScheme);

    } // namespace env
} // namespace reactnativecss

