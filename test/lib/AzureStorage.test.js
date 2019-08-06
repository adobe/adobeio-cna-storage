const { StorageError } = require('../../lib/StorageError')
const { AzureStorage } = require('../../lib/azure/AzureStorage')

const azure = require('@azure/storage-blob')
jest.mock('@azure/storage-blob')

const fakeSASCredentials = {
  sasURLPrivate: 'https://fake.com/private',
  sasURLPublic: 'https://fake.com/public'
}

beforeEach(async () => {
  expect.hasAssertions()
  jest.resetAllMocks()
})

describe('init', () => {
  const fakeAzureAborter = 'fakeAborter'
  const mockContainerCreate = jest.fn()
  const fakeUserCredentials = {
    containerName: 'fake',
    storageAccessKey: 'fakeKey',
    storageAccount: 'fakeAccount'
  }
  beforeEach(async () => {
    mockContainerCreate.mockReset()
    azure.ContainerURL = { fromServiceURL: jest.fn() }
    azure.Aborter = { none: fakeAzureAborter }
    azure.ContainerURL.fromServiceURL.mockReturnValue({ create: mockContainerCreate })
  })

  describe('with bad args', () => {
    test('when called with no arguments', async () => {
      expect.assertions(4)
      try {
        await AzureStorage.init()
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.BadArgument)
        expect(e.message).toContain('credentials')
        expect(e.message).toContain('required')
      }
    })
    test('when called with incomplete SAS credentials', async () => {
      expect.assertions(5)
      try {
        const badInput = { ...fakeSASCredentials }
        delete badInput.sasURLPrivate
        await AzureStorage.init(badInput)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.BadArgument)
        expect(e.message).toContain('credentials')
        expect(e.message).toContain('required')
        expect(e.message).toContain('sasURLPrivate')
      }
    })
    test('when called with incomplete user credentials', async () => {
      expect.assertions(5)
      try {
        const badInput = { ...fakeUserCredentials }
        delete badInput.containerName
        await AzureStorage.init(badInput)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.BadArgument)
        expect(e.message).toContain('credentials')
        expect(e.message).toContain('required')
        expect(e.message).toContain('containerName')
      }
    })
    test('when called with both sas and user credentials', async () => {
      expect.assertions(4)
      try {
        await AzureStorage.init({ ...fakeUserCredentials, ...fakeSASCredentials })
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.BadArgument)
        expect(e.message).toContain('credentials')
        expect(e.message).toContain('conflict')
      }
    })
  })

  describe('with azure storage account credentials', () => {
    test('when public/private blob containers do not exist', async () => {
      const storage = await AzureStorage.init(fakeUserCredentials)
      expect(storage).toBeInstanceOf(AzureStorage)
      expect(mockContainerCreate).toHaveBeenCalledTimes(2)
      expect(mockContainerCreate).toHaveBeenCalledWith(fakeAzureAborter, {})
      expect(mockContainerCreate).toHaveBeenCalledWith(fakeAzureAborter, { access: 'blob' })
    })
    test('when blob containers already exist', async () => {
      // here we make sure that no error is thrown (ignore if already exist)
      mockContainerCreate.mockRejectedValue({ body: { Code: 'ContainerAlreadyExists' } })
      const storage = await AzureStorage.init(fakeUserCredentials)
      expect(storage).toBeInstanceOf(AzureStorage)
      expect(mockContainerCreate).toHaveBeenCalledTimes(2)
      expect(mockContainerCreate).toHaveBeenCalledWith(fakeAzureAborter, {})
      expect(mockContainerCreate).toHaveBeenCalledWith(fakeAzureAborter, { access: 'blob' })
    })
    test('when there is an error on blob container creation', async () => {
      expect.assertions(2)
      mockContainerCreate.mockRejectedValue('error')
      try {
        await AzureStorage.init(fakeUserCredentials)
      } catch (e) {
        // we expect every provider error to be wrapped
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
      }
    })
    test('when there is an error with status on blob container creation', async () => {
      expect.assertions(3)
      mockContainerCreate.mockRejectedValue({ response: { status: 500 } })
      try {
        await AzureStorage.init(fakeUserCredentials)
      } catch (e) {
        // we expect every provider error to be wrapped
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
        expect(e.message).toContain('500')
      }
    })
    test('when there is an error with forbidden status on blob container creation', async () => {
      expect.assertions(2)
      mockContainerCreate.mockRejectedValue({ response: { status: 403 } })
      try {
        await AzureStorage.init(fakeUserCredentials)
      } catch (e) {
        // we expect every provider error to be wrapped
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Forbidden)
      }
    })
  })

  // change to describe with beforeEach when more than one test for SAS credentials
  test('with azure SAS credentials', async () => {
    // setup & before
    const fakeAzurePipeline = 'fakeAzurePipeline'
    const fakeAzureAborter = 'fakeAborter'
    azure.StorageURL = { newPipeline: () => fakeAzurePipeline }
    azure.ContainerURL = jest.fn()
    azure.Aborter = { none: fakeAzureAborter }
    // test
    const storage = await AzureStorage.init(fakeSASCredentials)
    expect(azure.ContainerURL).toHaveBeenNthCalledWith(1, fakeSASCredentials.sasURLPrivate, fakeAzurePipeline)
    expect(azure.ContainerURL).toHaveBeenNthCalledWith(2, fakeSASCredentials.sasURLPublic, fakeAzurePipeline)
    expect(storage).toBeInstanceOf(AzureStorage)
  })
})

describe('list', () => {
  /* Common setup for list tests */
  // could be also OpenWhisk or regular azure credentials
  const fileInPrivateDir = 'dir/inadir/file.html'
  const fileInRoot = 'afile.html'
  const fileInPublicDir = 'public/afile.html'
  const fileInPublicSubDir = 'public/sub/afile.html'
  const fileWithoutExtension = 'afile'
  const privateDir = 'some/private/dir/'
  const publicDir = 'public/some/dir/'

  const fakeAzureListResponse = (files, marker) => { return { marker: marker, segment: { blobItems: files.map(name => { return { name } }) } } }
  const fakeAzureFileProps = { fake: 'props' }
  const mockBlobGetProperties = jest.fn()
  const mockContainerPublicList = jest.fn()
  const mockContainerPrivateList = jest.fn()
  const fakeAborter = 'fakeAborter'
  const fakeListArguments = (prefix, marker) => [fakeAborter, marker, { prefix: prefix, delimiter: '/' }]

  let storage
  beforeEach(async () => {
    mockBlobGetProperties.mockReset()
    mockContainerPublicList.mockReset()
    mockContainerPrivateList.mockReset()
    azure.ContainerURL = jest.fn()
    azure.BlockBlobURL.fromContainerURL = jest.fn().mockReturnValue({
      getProperties: mockBlobGetProperties
    })
    storage = await AzureStorage.init(fakeSASCredentials)
    storage._azure.containerURLPrivate = { listBlobFlatSegment: mockContainerPrivateList }
    storage._azure.containerURLPublic = { listBlobFlatSegment: mockContainerPublicList }
    storage._azure.aborter = fakeAborter
  })

  describe('a file', () => {
    test('when it exists', async () => {
      mockBlobGetProperties.mockResolvedValue(fakeAzureFileProps)
      expect(await storage.list(fileInPrivateDir)).toEqual([fileInPrivateDir])
      expect(await storage.list(fileInRoot)).toEqual([fileInRoot])
      expect(await storage.list(fileInPublicDir)).toEqual([fileInPublicDir])
      expect(await storage.list(fileInPublicSubDir)).toEqual([fileInPublicSubDir])
      expect(await storage.list(fileWithoutExtension)).toEqual([fileWithoutExtension])
      expect(mockBlobGetProperties).toHaveBeenCalled()
      expect(mockContainerPublicList).toHaveBeenCalledTimes(0)
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(0)
    })
    test('when it does not exist', async () => {
      mockBlobGetProperties.mockRejectedValue({ response: { status: 404 } })
      expect(await storage.list(fileInPrivateDir)).toEqual([])
      expect(await storage.list(fileInRoot)).toEqual([])
      expect(await storage.list(fileInPublicDir)).toEqual([])
      expect(await storage.list(fileInPublicSubDir)).toEqual([])
      expect(await storage.list(fileWithoutExtension)).toEqual([])
      expect(mockBlobGetProperties).toHaveBeenCalled()
      expect(mockContainerPublicList).toHaveBeenCalledTimes(0)
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(0)
    })
    test('when there is a provider forbidden access error', async () => {
      expect.assertions(2)
      mockBlobGetProperties.mockRejectedValue({ response: { status: 403 } })
      try {
        await storage.list(fileInPrivateDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Forbidden)
      }
    })
    test('when there is a provider error with a status code', async () => {
      expect.assertions(3)
      mockBlobGetProperties.mockRejectedValue({ response: { status: 500 } })
      try {
        await storage.list(fileInPrivateDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
        expect(e.message).toContain('500')
      }
    })
    test('when there is a provider error without a status code', async () => {
      expect.assertions(2)
      mockBlobGetProperties.mockRejectedValue(true)
      try {
        await storage.list(fileInPrivateDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
      }
    })
  })

  describe('a directory', () => {
    const testRoot = (rootString) => async () => {
      mockContainerPublicList.mockResolvedValue(fakeAzureListResponse([fileInPublicDir, fileInPublicSubDir]))
      mockContainerPrivateList.mockResolvedValue(fakeAzureListResponse([fileInPrivateDir, fileInRoot]))
      expect(await storage.list(rootString)).toEqual([fileInPrivateDir, fileInRoot, fileInPublicDir, fileInPublicSubDir])
      expect(mockBlobGetProperties).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledTimes(1)
      expect(mockContainerPublicList).toHaveBeenCalledWith(...fakeListArguments('public'))
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(1)
      expect(mockContainerPrivateList).toHaveBeenCalledWith(...fakeListArguments(''))
    }
    test('when it is the root (`/`)', testRoot('/'))
    test('when it is the root (empty string)', testRoot(''))
    test('when it is the root (undefined arg)', testRoot())

    test('when it is a private', async () => {
      const files = ['file1', 'subdir/file2', 'another/subdir/file3'].map(f => privateDir + f)
      mockContainerPrivateList.mockResolvedValue(fakeAzureListResponse(files))
      expect(await storage.list(privateDir)).toEqual(files)
      expect(mockBlobGetProperties).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledTimes(0)
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(1)
      expect(mockContainerPrivateList).toHaveBeenCalledWith(...fakeListArguments(privateDir))
    })
    test('when it is a public', async () => {
      const files = ['file1', 'subdir/file2', 'another/subdir/file3'].map(f => publicDir + f)
      mockContainerPublicList.mockResolvedValue(fakeAzureListResponse(files))
      expect(await storage.list(publicDir)).toEqual(files)
      expect(mockBlobGetProperties).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledTimes(1)
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledWith(...fakeListArguments(publicDir))
    })
    test('when multiple calls are needed to list all files', async () => {
      const files = [['file1', 'subdir/file2', 'another/subdir/file3'], ['file4', 'subdir/file5', 'another/subdir/file6'], ['file7']].map(arr => arr.map(f => publicDir + f))
      let count = 0
      mockContainerPublicList.mockImplementation(async () => { return fakeAzureListResponse(files[count++], count < files.length) })
      expect(await storage.list(publicDir)).toEqual(files.reduce((prev, curr) => prev.concat(curr), []))
      expect(mockBlobGetProperties).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledTimes(3)
      expect(mockContainerPrivateList).toHaveBeenCalledTimes(0)
      expect(mockContainerPublicList).toHaveBeenCalledWith(...fakeListArguments(publicDir))
    })
    test('when there is a provider forbidden access error', async () => {
      expect.assertions(2)
      mockContainerPublicList.mockRejectedValue({ response: { status: 403 } })
      try {
        await storage.list(publicDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Forbidden)
      }
    })
    test('when there is a provider error with a status code', async () => {
      expect.assertions(3)
      mockContainerPublicList.mockRejectedValue({ response: { status: 500 } })
      try {
        await storage.list(publicDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
        expect(e.message).toContain('500')
      }
    })
    test('when there is a provider error without a status code', async () => {
      expect.assertions(2)
      mockContainerPublicList.mockRejectedValue(true)
      try {
        await storage.list(publicDir)
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError)
        expect(e.code).toEqual(StorageError.codes.Internal)
      }
    })
  })
})
