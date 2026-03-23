module.exports = {
  baseLocale: 'zh-CN',
  locales: ['en', 'de', 'pt', 'es', 'fr', 'zh-TW', 'it', 'ko', 'ja', 'ru', 'ar'],
  localePath: 'src/i18n/locales',
  openAIApiKey: process.env.OPENAI_API_KEY,
  openAIApiModel: 'gpt-4o-mini',
  openAIApiUrl: 'https://api2.acedata.cloud',
  openAIApiUrlPath: '/openai/chat/completions',
  modelContextLimit: 4000,
  additionalReqBodyParams: {
    response_format: {
      type: 'json_object'
    }
  },
  systemPromptTemplate: ({ languageName, context }) => {
    return (
      `Translate the i18n JSON file to ${languageName} according to the BCP 47 standard` +
      (context
        ? `\nHere are some contexts to help with better translation. ---${context}---`
        : '') +
      `\nKeep the keys the same as the original file and make sure the output remains a valid i18n JSON file.` +
      ` For every key, there may be another key with suffix '.comment' like '_{key}.comment'. Use that comment as translation context whenever it exists.`
    );
  }
};
