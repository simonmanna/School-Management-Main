# kotlinx.serialization keeps its generated serializers on the companion; R8 needs
# the metadata to find them for @Serializable classes.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.school.portal.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.school.portal.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit interfaces are reflective; their signatures must survive shrinking.
-keep,allowobfuscation,allowshrinking interface com.school.portal.data.api.**
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking class retrofit2.Response
