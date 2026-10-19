const isNode = typeof window === 'undefined';

const isClearAccessTokenRequested = () =>
	!isNode && new URLSearchParams(window.location.search).get("clear_access_token") === 'true';

const clearStoredAccessToken = () => {
	if (!isNode) {
		window.localStorage.removeItem('base44_access_token');
		window.localStorage.removeItem('token');
	}
};

const getAccessToken = () => {
	if (isNode) return 'mock-token';
	return window.localStorage.getItem('token') || window.localStorage.getItem('base44_access_token') || 'mock-token';
};

const getAppParams = () => {
	if (isClearAccessTokenRequested()) {
		clearStoredAccessToken();
	}
	return {
		appId: 'higi-leito-pro',
		token: getAccessToken(),
		functionsVersion: 'v1',
		appBaseUrl: !isNode ? window.location.origin : '',
	};
};

export const appParams = {
	...getAppParams()
};
