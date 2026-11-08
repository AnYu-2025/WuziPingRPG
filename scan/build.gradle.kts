plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// 扫描相机 2.4.0，作为天工的「扫描」模块以库的形式并入。
// 原独立应用的 applicationId、签名配置和 keystore 不再随仓库出现；
// 天工打包时把这里的三个 Activity 合并进 cn.wuziping.ember。
android {
    namespace = "com.scan.camera"
    compileSdk = 34

    defaultConfig {
        minSdk = 29
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
    lint {
        abortOnError = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    val camerax = "1.3.4"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")

    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    implementation("androidx.viewpager2:viewpager2:1.1.0")

    // 离线中文 OCR（bundled 版：模型打进 APK，运行不需要谷歌服务框架，不联网）
    implementation("com.google.mlkit:text-recognition-chinese:16.0.0")
}

// 纯 JVM 行为回归，不依赖手机，也不额外下载测试框架。
// 用法：gradle :scan:regressionCheck
tasks.register<JavaExec>("regressionCheck") {
    dependsOn("compileDebugUnitTestKotlin")
    mainClass.set("com.scan.camera.RegressionChecksKt")
    // 库模块的运行时配置同时暴露 jar / aar 等多种变体，这里显式只取 class jar。
    val runtimeJars = configurations.getByName("debugUnitTestRuntimeClasspath").incoming.artifactView {
        attributes { attribute(Attribute.of("artifactType", String::class.java), "android-classes-jar") }
    }.files
    classpath = files("build/tmp/kotlin-classes/debugUnitTest", "build/tmp/kotlin-classes/debug") + runtimeJars
}
