package com.school.portal.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The school's colours.
 *
 * Deep green and brass, matching the web portal's brand tokens so a parent who
 * has seen one recognises the other. Material You dynamic colour is offered on
 * Android 12+ but defaults OFF: a school's identity should not be repainted by
 * whatever wallpaper a pupil picked.
 */
private val BrandGreen = Color(0xFF0F3D2E)
private val BrandGreenLight = Color(0xFF2E6B52)
private val Brass = Color(0xFFB08A3E)
private val Ink = Color(0xFF14181A)
private val Paper = Color(0xFFFBFBF9)
private val PaperDim = Color(0xFFF1F2EE)
private val NightSurface = Color(0xFF171A18)
private val NightBackground = Color(0xFF101311)
private val Danger = Color(0xFFB3261E)

private val LightScheme = lightColorScheme(
    primary = BrandGreen,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD7E8DF),
    onPrimaryContainer = Color(0xFF05241A),
    secondary = Brass,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF3E6CA),
    onSecondaryContainer = Color(0xFF3A2C08),
    tertiary = BrandGreenLight,
    background = Paper,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = PaperDim,
    onSurfaceVariant = Color(0xFF50574F),
    outline = Color(0xFFBFC4BD),
    outlineVariant = Color(0xFFDFE3DC),
    error = Danger,
    onError = Color.White,
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFF8FD3B4),
    onPrimary = Color(0xFF04281B),
    primaryContainer = Color(0xFF1F4A38),
    onPrimaryContainer = Color(0xFFD7F2E4),
    secondary = Color(0xFFE2C584),
    onSecondary = Color(0xFF3A2C08),
    tertiary = Color(0xFF9FD8BE),
    background = NightBackground,
    onBackground = Color(0xFFE6E9E5),
    surface = NightSurface,
    onSurface = Color(0xFFE6E9E5),
    surfaceVariant = Color(0xFF262A27),
    onSurfaceVariant = Color(0xFFBEC5BD),
    outline = Color(0xFF555B54),
    outlineVariant = Color(0xFF2E332F),
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
)

/**
 * Body text starts at 16sp and never shrinks below 14sp.
 *
 * Primary-age pupils read this on cheap 5-inch screens in daylight. The
 * tighter steps Material's defaults use for dense desktop UI are a legibility
 * problem here, not a density one.
 */
private val PortalTypography = Typography().let { base ->
    base.copy(
        headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
        bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
        bodySmall = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        labelLarge = base.labelLarge.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    )
}

@Composable
fun SchoolPortalTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkScheme
        else -> LightScheme
    }
    MaterialTheme(colorScheme = scheme, typography = PortalTypography, content = content)
}

/** Semantic colours Material's scheme has no slot for. */
object PortalColors {
    val success = Color(0xFF1C7B4D)
    val successContainer = Color(0xFFD9EFE2)
    val warning = Color(0xFF8A5A00)
    val warningContainer = Color(0xFFFCEBCB)
}
