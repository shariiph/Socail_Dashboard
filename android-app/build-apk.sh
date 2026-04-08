#!/bin/bash
set -e

# 1. Setup Environment
export PROJECT_ROOT=$(pwd)
export JAVA_HOME=$PROJECT_ROOT/jdk-bin/Contents/Home
export ANDROID_HOME=$PROJECT_ROOT/android-sdk
export GRADLE_HOME=$PROJECT_ROOT/gradle-bin
export PATH=$JAVA_HOME/bin:$GRADLE_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

echo "🚀 Starting Social Inbox APK Build..."
echo "📍 JAVA_HOME: $JAVA_HOME"
echo "📍 ANDROID_HOME: $ANDROID_HOME"

# 2. Accept SDK Licenses
echo "📝 Accepting Licenses..."
yes | sdkmanager --licenses > /dev/null 2>&1 || true

# 3. Clean and Build
echo "🏗️  Running Gradle Assemble..."
# Run without daemon to avoid memory/native issues in restricted environments
gradle assembleDebug --no-daemon --stacktrace --info

# 4. Success Handling
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo "✅ Build Successful!"
    cp "$APK_PATH" "$PROJECT_ROOT/social-inbox-build.apk"
    echo "📍 Final APK located at: $PROJECT_ROOT/social-inbox-build.apk"
else
    echo "❌ Build failed - APK not found."
    exit 1
fi
