// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { sharedConfigs } from '@narduk/eslint-config'
export default withNuxt(
    ...sharedConfigs,
    {
        rules: {
            // Disable atx/ design-system rules — this app intentionally uses native
            // HTML elements and raw Tailwind colors outside the shared layer's UI kit.
            'atx/no-raw-tailwind-colors': 'off',
            'atx/no-native-button': 'off',
            'atx/no-native-input': 'off',
            'atx/no-native-form': 'off',
            'atx/no-native-details': 'off',
            'atx/no-native-table': 'off',
            'atx/no-native-layout': 'off',
            'atx/no-inline-svg': 'off',
            'atx/no-inline-hex': 'off',
            'atx/no-fetch-in-component': 'off',
            'atx/no-style-block-layout': 'off',
            'atx/no-attrs-on-fragment': 'off',
            'atx/no-multi-statement-inline-handler': 'off',
            'atx/lucide-icons-only': 'off',
            'atx/require-validated-body': 'off',
            'atx/require-validated-query': 'off',
            'atx/prefer-drizzle-operators': 'off',
            'atx/prefer-ulink': 'off',

            // Non-atx rules that need invasive refactoring
            'no-empty': 'off',
            'nuxt-guardrails/no-raw-fetch': 'off',
            'nuxt-guardrails/no-ssr-dom-access': 'off',
            'vue-official/no-composable-dom-access-without-client-guard': 'off',
            '@typescript-eslint/no-dynamic-delete': 'off',
            'vue/no-side-effects-in-computed-properties': 'off',
            'vue/return-in-computed-property': 'off',
            'vue/no-unused-vars': 'off',
            'import/no-duplicates': 'off',
            'import-x/no-duplicates': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
        },
    },
)
