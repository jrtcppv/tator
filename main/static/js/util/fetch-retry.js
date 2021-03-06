function fetchRetry(url, options) {
  return new Promise((resolve, reject) => {
    let retry = 0;
    const delay = [50, 100, 200];
    const max_retry = delay.length;
    function success(response) {
      resolve(response);
    }
    function failure(error) {
      if (retry < max_retry) {
        setTimeout(fetchUrl, delay[retry]);
      } else {
        reject(error);
      }
    }
    function finalHandler(finalError) {
      throw finalError;
    }
    function fetchUrl() {
      return fetch(url, options)
      .then(success)
      .catch(failure)
      .catch(finalHandler);
    }
    fetchUrl();
  });
}
