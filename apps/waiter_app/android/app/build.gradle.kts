plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val waiterKeystorePath = providers.environmentVariable("WAITER_KEYSTORE_PATH").orNull
val waiterKeystorePassword = providers.environmentVariable("WAITER_KEYSTORE_PASSWORD").orNull
val waiterKeyAlias = providers.environmentVariable("WAITER_KEY_ALIAS").orNull
val waiterKeyPassword = providers.environmentVariable("WAITER_KEY_PASSWORD").orNull

android {
    namespace = "com.bigbites.familyrestaurant.waiter"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    signingConfigs {
        create("release") {
            if (!waiterKeystorePath.isNullOrBlank()) {
                storeFile = file(waiterKeystorePath)
            }
            storePassword = waiterKeystorePassword.orEmpty()
            keyAlias = waiterKeyAlias.orEmpty()
            keyPassword = waiterKeyPassword.orEmpty()
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.bigbites.familyrestaurant.waiter"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

tasks.configureEach {
    if (name == "validateSigningRelease") {
        doFirst {
            check(
                !waiterKeystorePath.isNullOrBlank() &&
                    !waiterKeystorePassword.isNullOrBlank() &&
                    !waiterKeyAlias.isNullOrBlank() &&
                    !waiterKeyPassword.isNullOrBlank() &&
                    file(waiterKeystorePath).isFile,
            ) {
                "Release signing is not configured. Set WAITER_KEYSTORE_PATH, " +
                    "WAITER_KEYSTORE_PASSWORD, WAITER_KEY_ALIAS, and WAITER_KEY_PASSWORD."
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
